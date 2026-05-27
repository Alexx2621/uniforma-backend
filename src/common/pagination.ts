export type PaginationResult<T> = {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

export const parseBooleanQuery = (value: unknown) => {
  const normalized = `${value ?? ''}`.trim().toLowerCase();
  return ['1', 'true', 'si', 'sí', 'yes'].includes(normalized);
};

export const parsePaginationQuery = (query: any = {}) => {
  const requested =
    query.page !== undefined ||
    query.pageSize !== undefined ||
    query.limit !== undefined ||
    query.take !== undefined ||
    query.offset !== undefined ||
    parseBooleanQuery(query.paginated);
  if (!requested) return null;

  const pageSizeRaw = Number(query.pageSize ?? query.limit ?? query.take ?? 25);
  const pageSize = Math.min(Math.max(Number.isFinite(pageSizeRaw) ? Math.floor(pageSizeRaw) : 25, 1), 100);
  const offsetRaw = Number(query.offset);
  const pageRaw = Number(query.page ?? 0);
  const page = Math.max(0, Number.isFinite(pageRaw) ? Math.floor(pageRaw) : 0);
  const skip = Number.isFinite(offsetRaw) && offsetRaw >= 0 ? Math.floor(offsetRaw) : page * pageSize;

  return { page, pageSize, skip, take: pageSize };
};

export const paginatedResponse = <T>(data: T[], total: number, page: number, pageSize: number): PaginationResult<T> => ({
  data,
  total,
  page,
  pageSize,
  totalPages: Math.ceil(total / Math.max(1, pageSize)),
});
