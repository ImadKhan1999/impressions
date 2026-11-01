import type { DeviceProfile, ErrorCode, RedirectHop, RunSettings, TaskResultDetails } from '@impressions/shared';
import type { ResolvedProxy } from '../proxies/agents.js';

export interface EngineTask {
  taskId: number;
  runId: number;
  url: string;
  profile: DeviceProfile | null;
  proxy: ResolvedProxy | null;
  settings: RunSettings;
  signal: AbortSignal;
}

export interface EngineResult {
  /** Final outcome: success (<400), failed (>=400), error (transport/engine failure). */
  status: 'success' | 'failed' | 'error';
  finalUrl: string | null;
  finalStatus: number | null;
  redirectCount: number;
  totalTimeMs: number;
  errorCode: ErrorCode | null;
  errorMessage: string | null;
  hops: RedirectHop[];
  details: TaskResultDetails;
}

export function outcomeFor(finalStatus: number | null, errorCode: ErrorCode | null): EngineResult['status'] {
  if (errorCode && errorCode !== 'HTTP_ERROR') return 'error';
  if (finalStatus === null) return 'error';
  return finalStatus >= 400 ? 'failed' : 'success';
}

/** Maps Node / Playwright error messages and codes to the shared taxonomy. */
export function classifyError(err: unknown): { code: ErrorCode; message: string } {
  const e = err as { code?: string; name?: string; message?: string; cause?: unknown };
  const code = e?.code ?? '';
  // Only classify on the first line: Playwright appends a call log that may contain URLs.
  const msg = (e?.message ?? String(err)).split('\n')[0]!.trim();
  const lower = msg.toLowerCase();

  if (e?.name === 'AbortError' || code === 'ABORT_ERR') return { code: 'ABORTED', message: 'Aborted' };
  if (e?.name === 'TimeoutError' || code === 'ETIMEDOUT' || code === 'ESOCKETTIMEDOUT' || /timeout|timed out|timed_out/.test(lower))
    return { code: 'TIMEOUT', message: msg };
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN' || /err_name_not_resolved|getaddrinfo|ns_error_unknown_host|could not resolve/.test(lower))
    return { code: 'DNS_FAILURE', message: msg };
  if (/err_unsafe_port|err_blocked_by_client|err_blocked_by_response/.test(lower))
    return { code: 'UNSUPPORTED', message: msg };
  if (code === 'ECONNREFUSED' || code === 'EHOSTUNREACH' || code === 'ENETUNREACH' || /err_address_unreachable|err_internet_disconnected/.test(lower) || /err_connection_refused|ns_error_connection_refused|could not connect/.test(lower))
    return { code: 'CONNECTION_REFUSED', message: msg };
  if (code === 'ECONNRESET' || code === 'EPIPE' || /err_connection_reset|err_empty_response|socket hang up|ns_error_net_reset|connection was reset/.test(lower))
    return { code: 'CONNECTION_RESET', message: msg };
  if (/proxy|socks|err_tunnel_connection_failed|ns_error_proxy/.test(lower) || code.startsWith('ERR_SOCKS'))
    return { code: 'PROXY_ERROR', message: msg };
  if (/cert|ssl|tls|err_ssl|sec_error|self.signed|unable to verify|ns_error_net_inadequate_security/.test(lower) || code.startsWith('ERR_TLS') || code.includes('CERT'))
    return { code: 'TLS_ERROR', message: msg };
  if (/executable doesn't exist|browsertype.launch|please run the following command to download/.test(lower))
    return { code: 'BROWSER_NOT_INSTALLED', message: msg };
  if (/target page, context or browser has been closed|browser has disconnected|crash/.test(lower))
    return { code: 'BROWSER_ERROR', message: msg };
  if (/err_too_many_redirects|redirect limit/.test(lower)) return { code: 'TOO_MANY_REDIRECTS', message: msg };
  return { code: 'UNKNOWN', message: msg };
}
