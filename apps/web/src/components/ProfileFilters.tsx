import { Search } from 'lucide-react';
import { BROWSERS, ENGINES, FORM_FACTORS, PLATFORMS, PROFILE_SOURCES, type ProfileFacets, type ProfileFilter } from '@impressions/shared';
import { BROWSER_LABEL, ENGINE_LABEL, FORM_LABEL, PLATFORM_LABEL } from '../lib/format';
import { ChipFilter, Input } from './ui';

const countsOf = <T extends string>(list: { value: T; count: number }[] | undefined) =>
  Object.fromEntries((list ?? []).map((f) => [f.value, f.count])) as Partial<Record<T, number>>;

export function ProfileFilters({
  filter,
  onChange,
  facets,
  showSource = false,
}: {
  filter: ProfileFilter;
  onChange: (f: ProfileFilter) => void;
  facets?: ProfileFacets;
  showSource?: boolean;
}) {
  return (
    <div className="space-y-4">
      <div className="relative">
        <Search className="pointer-events-none absolute top-2.5 left-3 size-4 text-slate-400" />
        <Input
          className="pl-9"
          placeholder="Search name, model, user agent or tag (e.g. “Galaxy S24 Samsung”)"
          value={filter.q ?? ''}
          onChange={(e) => onChange({ ...filter, q: e.target.value || undefined })}
        />
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <ChipFilter
          label="Platform"
          options={PLATFORMS}
          value={filter.platform ?? []}
          onChange={(v) => onChange({ ...filter, platform: v.length ? v : undefined })}
          counts={countsOf(facets?.platform)}
          format={(v) => PLATFORM_LABEL[v]!}
        />
        <ChipFilter
          label="Form factor"
          options={FORM_FACTORS}
          value={filter.formFactor ?? []}
          onChange={(v) => onChange({ ...filter, formFactor: v.length ? v : undefined })}
          counts={countsOf(facets?.formFactor)}
          format={(v) => FORM_LABEL[v]!}
        />
        <ChipFilter
          label="Browser"
          options={BROWSERS}
          value={filter.browser ?? []}
          onChange={(v) => onChange({ ...filter, browser: v.length ? v : undefined })}
          counts={countsOf(facets?.browser)}
          format={(v) => BROWSER_LABEL[v]!}
        />
        <ChipFilter
          label="Engine"
          options={ENGINES}
          value={filter.engine ?? []}
          onChange={(v) => onChange({ ...filter, engine: v.length ? v : undefined })}
          counts={countsOf(facets?.engine)}
          format={(v) => ENGINE_LABEL[v]!}
        />
        {showSource && (
          <ChipFilter
            label="Source"
            options={PROFILE_SOURCES}
            value={filter.source ?? []}
            onChange={(v) => onChange({ ...filter, source: v.length ? v : undefined })}
            counts={countsOf(facets?.source)}
          />
        )}
      </div>
    </div>
  );
}
