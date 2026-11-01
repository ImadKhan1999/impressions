import {
  LIMITS,
  profileInputSchema,
  type DeviceProfile,
  type GenerateResult,
  type ProfileCatalog,
  type ProfileFilter,
  type ProfileInput,
  type ProfileQuery,
  type ProfileSelection,
  type ProfileUpdate,
  type ProfileGenerateInput,
  profileGenerateSchema,
} from '@impressions/shared';
import type { NewProfile, ProfileRepository } from '../db/repositories/profiles.js';
import type { EventBus } from '../events/bus.js';
import { AppError, badRequest, notFound } from '../lib/errors.js';
import { BROWSER_CATALOG } from './catalog/browsers.js';
import { DEVICE_CATALOG } from './catalog/devices.js';
import { nativeEngineFor } from './engine-map.js';
import { browsersForDevice, builtinProfiles, generateProfiles, slugify } from './generator.js';
import { buildUserAgent } from './user-agent.js';

export class ProfileService {
  constructor(
    private readonly repo: ProfileRepository,
    private readonly bus: EventBus,
  ) {}

  /** Seeds the built-in library. Idempotent: existing slugs are left untouched. */
  seedBuiltins(): { created: number } {
    const { created } = this.repo.insertMany(builtinProfiles(), 'skip');
    if (created) this.bus.emit({ type: 'profiles.changed' });
    return { created };
  }

  list(q: ProfileQuery) {
    return this.repo.list(q);
  }

  facets(filter: ProfileFilter = {}) {
    return this.repo.facets(filter);
  }

  get(id: number): DeviceProfile {
    const p = this.repo.get(id);
    if (!p) throw notFound('Profile', id);
    return p;
  }

  catalog(): ProfileCatalog {
    return {
      devices: DEVICE_CATALOG.map(({ modelCode: _c, ...d }) => ({ ...d, browsers: browsersForDevice({ ...d }) })),
      browsers: BROWSER_CATALOG,
    };
  }

  previewUserAgent(input: Parameters<typeof buildUserAgent>[0]) {
    try {
      return buildUserAgent(input);
    } catch (e) {
      throw badRequest((e as Error).message);
    }
  }

  /** Turns validated input into a full profile, deriving the UA and engine when omitted. */
  private resolve(input: ReturnType<typeof profileInputSchema.parse>, source: NewProfile['source'], slug?: string): NewProfile {
    let userAgent = input.userAgent;
    let clientHints = input.clientHints ?? null;
    if (!userAgent) {
      try {
        const ua = buildUserAgent({
          platform: input.platform,
          formFactor: input.formFactor,
          modelCode: input.model && /^SM-/i.test(input.model) ? input.model : null,
          osVersion: input.osVersion,
          browser: input.browser,
          browserVersion: input.browserVersion,
        });
        userAgent = ua.userAgent;
        clientHints = input.clientHints === undefined ? ua.clientHints : clientHints;
      } catch (e) {
        throw badRequest((e as Error).message);
      }
    }
    return {
      slug: slug ?? slugify(`custom_${input.name}_${Date.now().toString(36)}`),
      name: input.name,
      platform: input.platform,
      formFactor: input.formFactor,
      vendor: input.vendor ?? null,
      model: input.model ?? null,
      osVersion: input.osVersion,
      browser: input.browser,
      browserVersion: input.browserVersion,
      engine: input.engine ?? nativeEngineFor(input.platform, input.browser),
      userAgent,
      clientHints,
      viewportWidth: input.viewportWidth,
      viewportHeight: input.viewportHeight,
      screenWidth: input.screenWidth,
      screenHeight: input.screenHeight,
      deviceScaleFactor: input.deviceScaleFactor,
      isMobile: input.isMobile,
      hasTouch: input.hasTouch,
      locale: input.locale,
      timezone: input.timezone,
      tags: input.tags,
      source,
      enabled: input.enabled,
    };
  }

  private ensureCapacity(adding: number): void {
    const total = this.repo.count();
    if (total + adding > LIMITS.maxProfiles) {
      throw new AppError(
        'PROFILE_LIMIT',
        `The library is limited to ${LIMITS.maxProfiles.toLocaleString()} profiles (currently ${total.toLocaleString()}).`,
        409,
      );
    }
  }

  create(raw: ProfileInput): DeviceProfile {
    const input = profileInputSchema.parse(raw);
    this.ensureCapacity(1);
    const p = this.repo.insert(this.resolve(input, 'custom'));
    this.bus.emit({ type: 'profiles.changed' });
    return p;
  }

  update(id: number, patch: ProfileUpdate): DeviceProfile {
    const current = this.get(id);
    const identityKeys = ['platform', 'formFactor', 'osVersion', 'browser', 'browserVersion', 'model'] as const;
    const identityChanged = identityKeys.some((k) => k in patch && patch[k] !== current[k]);
    const merged = profileInputSchema.parse({
      ...current,
      ...patch,
      // If identity fields changed and no explicit UA was supplied, rebuild the UA and hints.
      userAgent: patch.userAgent ?? (identityChanged ? undefined : current.userAgent),
      clientHints:
        patch.clientHints !== undefined
          ? patch.clientHints
          : patch.userAgent
            ? null
            : identityChanged
              ? undefined
              : current.clientHints,
    });
    const source = current.source === 'builtin' ? 'custom' : current.source;
    const updated = this.repo.update(id, this.resolve(merged, source, current.slug));
    if (!updated) throw notFound('Profile', id);
    this.bus.emit({ type: 'profiles.changed' });
    return updated;
  }

  delete(id: number): void {
    if (!this.repo.delete(id)) throw notFound('Profile', id);
    this.bus.emit({ type: 'profiles.changed' });
  }

  /** Resolves an id list or filter selection into concrete profile ids. */
  resolveSelection(sel: ProfileSelection, limit: number = LIMITS.maxProfiles): number[] {
    if ('ids' in sel) return [...new Set(sel.ids)].slice(0, limit);
    return this.repo.idsByFilter(sel.filter, limit);
  }

  bulk(sel: ProfileSelection, action: 'enable' | 'disable' | 'delete'): { affected: number } {
    const ids = this.resolveSelection(sel);
    const affected =
      action === 'delete' ? this.repo.deleteByIds(ids) : this.repo.setEnabledByIds(ids, action === 'enable');
    if (affected) this.bus.emit({ type: 'profiles.changed' });
    return { affected };
  }

  generate(raw: ProfileGenerateInput): GenerateResult {
    const input = profileGenerateSchema.parse(raw);
    const { profiles, unknownDevices } = generateProfiles({ ...input, source: 'generated' });
    if (unknownDevices.length) throw badRequest(`Unknown device ids: ${unknownDevices.join(', ')}`);
    const preview = profiles.slice(0, 20).map((p) => ({
      name: p.name,
      userAgent: p.userAgent,
      platform: p.platform,
      browser: p.browser,
      browserVersion: p.browserVersion,
      osVersion: p.osVersion,
    }));
    if (input.dryRun) {
      const existing = this.repo.existingSlugs(profiles.map((p) => p.slug));
      return { generated: profiles.length, created: 0, skipped: existing.size, preview };
    }
    const existing = this.repo.existingSlugs(profiles.map((p) => p.slug));
    this.ensureCapacity(profiles.length - existing.size);
    const { created, skipped } = this.repo.insertMany(profiles, 'skip');
    if (created) this.bus.emit({ type: 'profiles.changed' });
    return { generated: profiles.length, created, skipped, preview };
  }

  import(items: (ProfileInput & { slug?: string })[], onConflict: 'skip' | 'overwrite') {
    const resolved = items.map((raw, idx) => {
      const parsed = profileInputSchema.safeParse(raw);
      if (!parsed.success) {
        throw new AppError('VALIDATION_ERROR', `Profile #${idx + 1} is invalid`, 400, parsed.error.issues);
      }
      return this.resolve(parsed.data, 'imported', raw.slug ? slugify(raw.slug) : slugify(`import_${parsed.data.name}`));
    });
    const existing = this.repo.existingSlugs(resolved.map((p) => p.slug));
    this.ensureCapacity(resolved.length - existing.size);
    const res = this.repo.insertMany(resolved, onConflict);
    this.bus.emit({ type: 'profiles.changed' });
    return res;
  }

  *export(filter: ProfileFilter = {}): Generator<DeviceProfile> {
    yield* this.repo.iterate(filter);
  }

  countAll(): number {
    return this.repo.count();
  }

  countEnabled(): number {
    return this.repo.count({ enabled: true });
  }
}
