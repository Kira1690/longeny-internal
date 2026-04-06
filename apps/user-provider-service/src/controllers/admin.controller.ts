import type { AdminService } from '../services/admin.service.js';

export class AdminController {
  constructor(private adminService: AdminService) {}

  listProviders = async ({ query }: any) => {
    const result = await this.adminService.listProviders({
      status: query.status,
      search: query.search,
      page: query.page ? Number(query.page) : 1,
      limit: query.limit ? Number(query.limit) : 20,
      sortBy: query.sortBy,
      sortOrder: query.sortOrder as 'asc' | 'desc',
    });
    return { success: true, ...result };
  };

  updateProviderStatus = async ({ params, store, body }: any) => {
    const result = await this.adminService.updateProviderStatus(
      params.id,
      store.userId,
      body.status,
      body.reason,
    );
    return { success: true, data: result };
  };

  verifyProvider = async ({ params, store, body }: any) => {
    const result = await this.adminService.verifyProvider(params.id, store.userId, body);
    return { success: true, data: result };
  };

  listUsers = async ({ query }: any) => {
    const result = await this.adminService.listUsers({
      status: query.status,
      search: query.search,
      page: query.page ? Number(query.page) : 1,
      limit: query.limit ? Number(query.limit) : 20,
      sortBy: query.sortBy,
      sortOrder: query.sortOrder as 'asc' | 'desc',
    });
    return { success: true, ...result };
  };

  getUserDetail = async ({ params }: any) => {
    const result = await this.adminService.getUserDetail(params.id);
    return { success: true, data: result };
  };

  updateUserStatus = async ({ params, store, body }: any) => {
    const result = await this.adminService.updateUserStatus(
      params.id,
      store.userId,
      body.status,
      body.reason,
    );
    return { success: true, data: result };
  };

  listPrograms = async ({ query }: any) => {
    const result = await this.adminService.listPrograms({
      status: query.status,
      category: query.category,
      search: query.search,
      page: query.page ? Number(query.page) : 1,
      limit: query.limit ? Number(query.limit) : 20,
      sortBy: query.sortBy,
      sortOrder: query.sortOrder as 'asc' | 'desc',
    });
    return { success: true, ...result };
  };

  updateProgramStatus = async ({ params, store, body }: any) => {
    const result = await this.adminService.updateProgramStatus(
      params.id,
      store.userId,
      body.status,
      body.reason,
    );
    return { success: true, data: result };
  };

  getModerationQueue = async ({ query }: any) => {
    const result = await this.adminService.getModerationQueue({
      status: query.status,
      entityType: query.entityType,
      page: query.page ? Number(query.page) : 1,
      limit: query.limit ? Number(query.limit) : 20,
    });
    return { success: true, ...result };
  };

  moderateItem = async ({ params, store, body }: any) => {
    const result = await this.adminService.moderateItem(params.id, store.userId, body);
    return { success: true, data: result };
  };

  getAnalyticsOverview = async () => {
    const result = await this.adminService.getAnalyticsOverview();
    return { success: true, data: result };
  };

  getUserAnalytics = async ({ query }: any) => {
    const result = await this.adminService.getUserAnalytics({
      startDate: query.startDate,
      endDate: query.endDate,
      granularity: query.granularity as 'day' | 'week' | 'month',
    });
    return { success: true, data: result };
  };

  getRevenueAnalytics = async ({ query }: any) => {
    const result = await this.adminService.getRevenueAnalytics({
      startDate: query.startDate,
      endDate: query.endDate,
    });
    return { success: true, data: result };
  };

  getBookingAnalytics = async ({ query }: any) => {
    const result = await this.adminService.getBookingAnalytics({
      startDate: query.startDate,
      endDate: query.endDate,
    });
    return { success: true, data: result };
  };

  getAuditLogs = async ({ query }: any) => {
    const result = await this.adminService.getAuditLogs({
      adminId: query.adminId,
      actionType: query.actionType,
      targetType: query.targetType,
      page: query.page ? Number(query.page) : 1,
      limit: query.limit ? Number(query.limit) : 20,
    });
    return { success: true, ...result };
  };

  getDashboardOverview = async () => {
    const result = await this.adminService.getDashboardOverview();
    return { success: true, data: result };
  };

  getPendingProviders = async ({ query }: any) => {
    const result = await this.adminService.getPendingProviders({
      page: query.page ? Number(query.page) : 1,
      limit: query.limit ? Number(query.limit) : 20,
    });
    return { success: true, ...result };
  };

  suspendProvider = async ({ params, store, body }: any) => {
    const result = await this.adminService.suspendProvider(params.id, store.userId, body.reason);
    return { success: true, data: result };
  };

  getAiAnalytics = async ({ query }: any) => {
    const result = await this.adminService.getAiAnalytics({
      startDate: query.startDate,
      endDate: query.endDate,
    });
    return { success: true, data: result };
  };

  getProviderAnalytics = async ({ query }: any) => {
    const result = await this.adminService.getProviderAnalytics({
      startDate: query.startDate,
      endDate: query.endDate,
    });
    return { success: true, data: result };
  };

  getSettings = async ({ query }: any) => {
    const result = await this.adminService.getSettings(query.category);
    return { success: true, data: result };
  };

  updateSettings = async ({ store, body }: any) => {
    const result = await this.adminService.updateSettings(store.userId, body.settings || []);
    return { success: true, data: result };
  };

  exportReport = async ({ store, body }: any) => {
    const result = await this.adminService.exportReport(store.userId, body);
    return { success: true, data: result };
  };

  listContentFlags = async ({ query }: any) => {
    const result = await this.adminService.listContentFlags({
      status: query.status,
      entityType: query.entityType,
      page: query.page ? Number(query.page) : 1,
      limit: query.limit ? Number(query.limit) : 20,
    });
    return { success: true, ...result };
  };

  resolveContentFlag = async ({ params, store, body }: any) => {
    const result = await this.adminService.resolveContentFlag(params.id, store.userId, body);
    return { success: true, data: result };
  };
}
