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

  getProviderFull = async ({ params }: any) => {
    const result = await this.providerService.getProviderById(params.id);
    const p = result;

    const city = (p.location as any)?.city ?? null;
    const hourlyRate = p.hourly_rate ? parseFloat(String(p.hourly_rate)) : null;
    const isActive = p.status === 'verified' || p.status === 'pending';

    return {
      success: true,
      data: {
        provider_id: p.id,
        business_name: p.business_name,
        display_name: p.display_name ?? null,
        bio: p.bio ?? null,
        specialties: (p.specialties as string[]) ?? [],
        offers_virtual: p.offers_virtual,
        offers_in_person: p.offers_in_person,
        city,
        hourly_rate: hourlyRate,
        rating: parseFloat(String(p.rating_avg)) || 0,
        years_experience: p.years_experience ?? null,
        languages: ['en'],
        is_active: isActive,
      },
    };
  };

  listProviders = async ({ query }: any) => {
    const results = await this.providerService.listProviders({
      search: query.search,
      offersVirtual: query.offersVirtual ? query.offersVirtual === 'true' : undefined,
      offersInPerson: query.offersInPerson ? query.offersInPerson === 'true' : undefined,
      page: query.page ? Number(query.page) : 1,
      limit: query.limit ? Number(query.limit) : 50,
    });

    const data = results.data.map((p: any) => ({
      provider_id: p.id,
      business_name: p.business_name,
      display_name: p.display_name ?? null,
      bio: p.bio ?? null,
      specialties: (p.specialties as string[]) ?? [],
      offers_virtual: p.offers_virtual,
      offers_in_person: p.offers_in_person,
      city: (p.location as any)?.city ?? null,
      hourly_rate: p.hourly_rate ? parseFloat(String(p.hourly_rate)) : null,
      rating: parseFloat(String(p.rating_avg)) || 0,
      years_experience: p.years_experience ?? null,
      languages: ['en'],
      is_active: p.status === 'verified' || p.status === 'pending',
    }));

    return { success: true, data, pagination: results.pagination };
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
