export interface PaginationOptions {
  page?: number;
  limit?: number;
  defaultLimit?: number;
  maxLimit?: number;
}

export interface PaginationParams {
  page: number;
  limit: number;
  skip: number;
}

export interface PaginationMeta {
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export const DEFAULT_PAGE = 1;
export const DEFAULT_LIMIT = 10;
export const MAX_LIMIT = 50;

export const parsePagination = (
  options?: PaginationOptions,
  maxLimit: number = MAX_LIMIT
): PaginationParams => {
  const page = Math.max(DEFAULT_PAGE, Math.floor(Number(options?.page) || DEFAULT_PAGE));
  const fallbackLimit = options?.defaultLimit || DEFAULT_LIMIT;
  const rawLimit = Math.floor(Number(options?.limit) || fallbackLimit);
  const effectiveMax = options?.maxLimit || maxLimit;
  const limit = Math.min(Math.max(1, rawLimit), effectiveMax);
  const skip = (page - 1) * limit;

  return { page, limit, skip };
};

export const getPagination = parsePagination;

export const buildPaginationMeta = (total: number, page: number, limit: number): PaginationMeta => {
  const totalPages = limit > 0 ? Math.ceil(total / limit) : 0;
  return {
    total,
    page,
    limit,
    totalPages,
  };
};
