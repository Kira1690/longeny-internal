import type { BookingService } from '../services/booking.service.js';
import type { NotificationService } from '../services/notification.service.js';

export class InternalController {
  constructor(
    private bookingService: BookingService,
    private notificationService: NotificationService,
  ) {}

  // GET /internal/gdpr/user-data/:userId
  getUserData = async ({ params }: any) => {
    const [bookings, notifications] = await Promise.all([
      this.bookingService.getUserBookingsForExport(params.userId),
      this.notificationService.getUserNotificationsForExport(params.userId),
    ]);

    return {
      success: true,
      data: {
        bookings,
        notifications,
        exportedAt: new Date().toISOString(),
      },
      meta: { timestamp: new Date().toISOString() },
    };
  };

  // DELETE /internal/gdpr/user-data/:userId
  deleteUserData = async ({ params }: any) => {
    await Promise.all([
      this.bookingService.anonymizeUserBookings(params.userId),
      this.notificationService.deleteUserNotifications(params.userId),
    ]);

    return {
      success: true,
      data: {
        anonymized: true,
        userId: params.userId,
        processedAt: new Date().toISOString(),
      },
      message: 'User data anonymized/deleted from booking service',
      meta: { timestamp: new Date().toISOString() },
    };
  };
}
