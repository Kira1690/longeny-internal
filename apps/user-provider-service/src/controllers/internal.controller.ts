import type { UserService } from '../services/user.service.js';
import type { ProviderService } from '../services/provider.service.js';

export class InternalController {
  constructor(
    private userService: UserService,
    private providerService: ProviderService,
  ) {}

  getUserById = async ({ params }: any) => {
    const user = await this.userService.getUserById(params.id);
    return { success: true, data: user };
  };

  // Lookup by auth id (the JWT `sub`), which is what other services hold — getUserById above
  // keys on the internal users.id instead.
  getUserByAuthId = async ({ params }: any) => {
    const user = await this.userService.getProfile(params.authId);
    return { success: true, data: user };
  };

  getUserHealthProfile = async ({ params }: any) => {
    const profile = await this.userService.getSanitizedHealthProfile(params.id);
    return { success: true, data: profile };
  };

  getProviderById = async ({ params }: any) => {
    const provider = await this.providerService.getProviderById(params.id);
    return { success: true, data: provider };
  };

  // Paginated list of active providers for the bravelabs-agent provider-sync.
  // Envelope matches what manual_sync parses: body.data (array) + body.pagination.totalPages.
  listProvidersForSync = async ({ query }: any) => {
    const page = query.page ? Number(query.page) : undefined;
    const limit = query.limit ? Number(query.limit) : undefined;
    const result = await this.providerService.listProvidersForSync({ page, limit });
    return { success: true, data: result.data, pagination: result.pagination };
  };

  // Single provider in agent-sync shape (used by fetch_and_upsert -> data.data).
  getProviderForSync = async ({ params }: any) => {
    const provider = await this.providerService.getProviderForSync(params.id);
    return { success: true, data: provider };
  };

  getProviderAvailability = async ({ params, query }: any) => {
    const slots = await this.providerService.getProviderAvailabilityForDate(
      params.id,
      query.date || new Date().toISOString().split('T')[0],
    );
    return { success: true, data: slots };
  };

  getGdprUserData = async ({ params }: any) => {
    const data = await this.userService.getAllUserDataForGdpr(params.userId);
    return { success: true, data };
  };

  deleteGdprUserData = async ({ params }: any) => {
    const result = await this.userService.deleteAllUserData(params.userId);
    return { success: true, data: result };
  };
}
