import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AppSettings,
  DashboardStats,
  DeviceProfile,
  GenerateResult,
  ImportReport,
  Paginated,
  ProfileCatalog,
  ProfileFacets,
  ProfileFilter,
  ProfileInput,
  Proxy,
  ProxyInput,
  ProxyTestResult,
  RunCreateInput,
  RunProgress,
  RunSummary,
  SystemInfo,
  TaskDetail,
  TestRun,
  TestTask,
  UrlEntry,
  UrlList,
  ProfileGenerateInput,
  ProfileSelection,
} from '@impressions/shared';
import { api } from './client';

export const keys = {
  stats: ['stats'] as const,
  system: ['system'] as const,
  settings: ['settings'] as const,
  active: ['active'] as const,
  profiles: (q: object) => ['profiles', q] as const,
  facets: (q: object) => ['profiles', 'facets', q] as const,
  catalog: ['catalog'] as const,
  proxies: ['proxies'] as const,
  lists: ['url-lists'] as const,
  list: (id: number) => ['url-lists', id] as const,
  urls: (id: number, q: object) => ['url-lists', id, 'urls', q] as const,
  runs: (q: object) => ['runs', q] as const,
  run: (id: number) => ['run', id] as const,
  tasks: (id: number, q: object) => ['run', id, 'tasks', q] as const,
  summary: (id: number) => ['run', id, 'summary'] as const,
  task: (id: number) => ['task', id] as const,
};

/* ---------------------------------- system --------------------------------- */

export const useStats = () => useQuery({ queryKey: keys.stats, queryFn: () => api.get<DashboardStats>('/api/stats'), refetchInterval: 15_000 });
export const useSystem = () => useQuery({ queryKey: keys.system, queryFn: () => api.get<SystemInfo>('/api/system'), refetchInterval: 10_000 });
export const useActive = () => useQuery({ queryKey: keys.active, queryFn: () => api.get<RunProgress[]>('/api/active') });
export const useSettings = () => useQuery({ queryKey: keys.settings, queryFn: () => api.get<AppSettings>('/api/settings') });
export function useSaveSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (s: Partial<AppSettings>) => api.put<AppSettings>('/api/settings', s),
    onSuccess: (data) => qc.setQueryData(keys.settings, data),
  });
}

/* --------------------------------- profiles -------------------------------- */

export interface ProfileListQuery extends ProfileFilter {
  page: number;
  pageSize: number;
  sort?: 'name' | 'platform' | 'browser' | 'updated';
}

const filterToQuery = (f: ProfileFilter) => ({
  q: f.q,
  platform: f.platform,
  formFactor: f.formFactor,
  browser: f.browser,
  engine: f.engine,
  source: f.source,
  enabled: f.enabled,
});

export const useProfiles = (q: ProfileListQuery) =>
  useQuery({
    queryKey: keys.profiles(q),
    queryFn: () => api.get<Paginated<DeviceProfile>>('/api/profiles', { ...filterToQuery(q), page: q.page, pageSize: q.pageSize, sort: q.sort }),
    placeholderData: keepPreviousData,
  });

export const useFacets = (f: ProfileFilter = {}) =>
  useQuery({ queryKey: keys.facets(f), queryFn: () => api.get<ProfileFacets>('/api/profiles/facets', filterToQuery(f)), placeholderData: keepPreviousData });

export const useCatalog = () => useQuery({ queryKey: keys.catalog, queryFn: () => api.get<ProfileCatalog>('/api/profiles/catalog'), staleTime: Infinity });

export const useProfileCount = (f: ProfileFilter, enabled = true) =>
  useQuery({
    queryKey: ['profiles', 'count', f],
    queryFn: () => api.post<{ count: number }>('/api/profiles/count', f),
    enabled,
    placeholderData: keepPreviousData,
  });

function useInvalidate(...prefixes: string[]) {
  const qc = useQueryClient();
  return () => Promise.all(prefixes.map((p) => qc.invalidateQueries({ queryKey: [p] })));
}

export function useSaveProfile() {
  const inv = useInvalidate('profiles', 'stats');
  return useMutation({
    mutationFn: ({ id, data }: { id?: number; data: Partial<ProfileInput> }) =>
      id ? api.patch<DeviceProfile>(`/api/profiles/${id}`, data) : api.post<DeviceProfile>('/api/profiles', data),
    onSuccess: () => inv(),
  });
}

export function useDeleteProfile() {
  const inv = useInvalidate('profiles', 'stats');
  return useMutation({ mutationFn: (id: number) => api.del(`/api/profiles/${id}`), onSuccess: () => inv() });
}

export function useBulkProfiles() {
  const inv = useInvalidate('profiles', 'stats');
  return useMutation({
    mutationFn: (b: { selection: ProfileSelection; action: 'enable' | 'disable' | 'delete' }) =>
      api.post<{ affected: number }>('/api/profiles/bulk', b),
    onSuccess: () => inv(),
  });
}

export function useGenerateProfiles() {
  const inv = useInvalidate('profiles', 'stats');
  return useMutation({
    mutationFn: (g: ProfileGenerateInput) => api.post<GenerateResult>('/api/profiles/generate', g),
    onSuccess: (r) => {
      if (r.created) void inv();
    },
  });
}

export function useImportProfiles() {
  const inv = useInvalidate('profiles', 'stats');
  return useMutation({
    mutationFn: (body: { profiles: unknown[]; onConflict: 'skip' | 'overwrite' }) =>
      api.post<{ created: number; updated: number; skipped: number }>('/api/profiles/import', body),
    onSuccess: () => inv(),
  });
}

/* --------------------------------- proxies --------------------------------- */

export const useProxies = () => useQuery({ queryKey: keys.proxies, queryFn: () => api.get<Proxy[]>('/api/proxies') });

export function useSaveProxy() {
  const inv = useInvalidate('proxies', 'stats');
  return useMutation({
    mutationFn: ({ id, data }: { id?: number; data: Partial<ProxyInput> }) =>
      id ? api.patch<Proxy>(`/api/proxies/${id}`, data) : api.post<Proxy>('/api/proxies', data),
    onSuccess: () => inv(),
  });
}
export function useDeleteProxy() {
  const inv = useInvalidate('proxies', 'stats');
  return useMutation({ mutationFn: (id: number) => api.del(`/api/proxies/${id}`), onSuccess: () => inv() });
}
export function useTestProxy() {
  const inv = useInvalidate('proxies');
  return useMutation({
    mutationFn: ({ id, url }: { id: number; url?: string }) => api.post<ProxyTestResult>(`/api/proxies/${id}/test`, url ? { url } : {}),
    onSettled: () => inv(),
  });
}

/* -------------------------------- URL lists -------------------------------- */

export const useUrlLists = () => useQuery({ queryKey: keys.lists, queryFn: () => api.get<UrlList[]>('/api/url-lists') });
export const useUrlList = (id: number) => useQuery({ queryKey: keys.list(id), queryFn: () => api.get<UrlList>(`/api/url-lists/${id}`) });
export const useUrls = (id: number, q: { page: number; pageSize: number; q?: string }) =>
  useQuery({
    queryKey: keys.urls(id, q),
    queryFn: () => api.get<Paginated<UrlEntry>>(`/api/url-lists/${id}/urls`, q),
    placeholderData: keepPreviousData,
  });

export function useSaveUrlList() {
  const inv = useInvalidate('url-lists', 'stats');
  return useMutation({
    mutationFn: ({ id, data }: { id?: number; data: { name: string; description?: string | null } }) =>
      id ? api.patch<UrlList>(`/api/url-lists/${id}`, data) : api.post<UrlList>('/api/url-lists', data),
    onSuccess: () => inv(),
  });
}
export function useDeleteUrlList() {
  const inv = useInvalidate('url-lists', 'stats');
  return useMutation({ mutationFn: (id: number) => api.del(`/api/url-lists/${id}`), onSuccess: () => inv() });
}
export function useImportUrls(listId: number) {
  const inv = useInvalidate('url-lists', 'stats');
  return useMutation({
    mutationFn: (input: { file: File; format?: 'txt' | 'csv' } | { text: string }) => {
      if ('text' in input) return api.post<ImportReport>(`/api/url-lists/${listId}/urls`, { text: input.text });
      const fd = new FormData();
      if (input.format) fd.append('format', input.format);
      fd.append('file', input.file);
      return api.post<ImportReport>(`/api/url-lists/${listId}/import`, fd);
    },
    onSuccess: () => inv(),
  });
}
export function useDeleteUrls(listId: number) {
  const inv = useInvalidate('url-lists', 'stats');
  return useMutation({
    mutationFn: (sel: { ids: number[] } | { all: true }) => api.post<{ deleted: number }>(`/api/url-lists/${listId}/urls/delete`, sel),
    onSuccess: () => inv(),
  });
}

/* ----------------------------------- runs ---------------------------------- */

export const useRuns = (q: { page: number; pageSize: number; status?: string[]; q?: string }, refetch = false) =>
  useQuery({
    queryKey: keys.runs(q),
    queryFn: () => api.get<Paginated<TestRun>>('/api/runs', q),
    placeholderData: keepPreviousData,
    refetchInterval: refetch ? 5_000 : false,
  });

export const useRun = (id: number) =>
  useQuery({ queryKey: keys.run(id), queryFn: () => api.get<{ run: TestRun; progress: RunProgress | null }>(`/api/runs/${id}`) });

export const useRunSummary = (id: number, live: boolean) =>
  useQuery({ queryKey: keys.summary(id), queryFn: () => api.get<RunSummary>(`/api/runs/${id}/summary`), refetchInterval: live ? 4_000 : false });

export interface TaskListQuery {
  page: number;
  pageSize: number;
  status?: string[];
  engine?: string[];
  q?: string;
  errorCode?: string;
  sort?: 'id' | 'time' | 'redirects' | 'status';
  order?: 'asc' | 'desc';
}
export const useTasks = (runId: number, q: TaskListQuery, live: boolean) =>
  useQuery({
    queryKey: keys.tasks(runId, q),
    queryFn: () => api.get<Paginated<TestTask>>(`/api/runs/${runId}/tasks`, { ...q }),
    placeholderData: keepPreviousData,
    refetchInterval: live ? 3_000 : false,
  });

export const useTask = (id: number | null) =>
  useQuery({ queryKey: keys.task(id ?? 0), queryFn: () => api.get<TaskDetail>(`/api/tasks/${id}`), enabled: !!id });

export function useCreateRun() {
  const inv = useInvalidate('runs', 'stats', 'active');
  return useMutation({ mutationFn: (r: RunCreateInput) => api.post<TestRun>('/api/runs', r), onSuccess: () => inv() });
}

export function useRunAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, action }: { id: number; action: 'start' | 'pause' | 'resume' | 'cancel' | 'duplicate' }) =>
      api.post<TestRun>(`/api/runs/${id}/${action}`),
    onSuccess: (_r, v) => {
      void qc.invalidateQueries({ queryKey: ['runs'] });
      void qc.invalidateQueries({ queryKey: keys.run(v.id) });
      void qc.invalidateQueries({ queryKey: keys.active });
    },
  });
}

export function useDeleteRun() {
  const inv = useInvalidate('runs', 'stats');
  return useMutation({ mutationFn: (id: number) => api.del(`/api/runs/${id}`), onSuccess: () => inv() });
}
