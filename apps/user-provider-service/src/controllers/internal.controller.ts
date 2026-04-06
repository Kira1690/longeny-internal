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

  getUserHealthProfile = async ({ params }: any) => {
    const profile = await this.userService.getSanitizedHealthProfile(params.id);
    return { success: true, data: profile };
  };

  getProviderById = async ({ params }: any) => {
    const provider = await this.providerService.getProviderById(params.id);
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
