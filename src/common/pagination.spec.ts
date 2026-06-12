import { paginatedResponse, parsePaginationQuery } from './pagination';

describe('pagination helpers', () => {
  it('returns null when pagination is not requested', () => {
    expect(parsePaginationQuery({})).toBeNull();
  });

  it('normalizes page, pageSize, skip and take', () => {
    expect(parsePaginationQuery({ page: '2', pageSize: '25' })).toEqual({
      page: 2,
      pageSize: 25,
      skip: 50,
      take: 25,
    });
  });

  it('caps pageSize to protect the database', () => {
    expect(parsePaginationQuery({ page: '0', pageSize: '5000' })).toEqual({
      page: 0,
      pageSize: 100,
      skip: 0,
      take: 100,
    });
  });

  it('builds a consistent paginated response', () => {
    expect(paginatedResponse([{ id: 1 }], 26, 1, 10)).toEqual({
      data: [{ id: 1 }],
      total: 26,
      page: 1,
      pageSize: 10,
      totalPages: 3,
    });
  });
});
