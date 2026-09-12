import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { PaginationQueryDto } from '../common/dto/pagination-query.dto';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import { RequestUploadUrlDto } from './dto/request-upload-url.dto';
import { ReviewDto } from './dto/review-document.dto';
import { KycService } from './kyc.service';

@Controller('kyc')
export class KycController {
  constructor(private readonly kycService: KycService) {}

  @Roles(UserRole.CLEANER)
  @Post('documents/upload-url')
  requestUploadUrl(@CurrentUser() user: AuthenticatedUser, @Body() dto: RequestUploadUrlDto) {
    return this.kycService.requestUploadUrl(user, dto);
  }

  @Roles(UserRole.CLEANER)
  @Post('documents/:id/confirm')
  confirmUpload(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.kycService.confirmUpload(user, id);
  }

  @Roles(UserRole.CLEANER)
  @Get('status')
  getStatus(@CurrentUser('id') userId: string) {
    return this.kycService.getStatus(userId);
  }

  /** Owner or admin — the ownership check lives in the service. */
  @Get('documents/:id/download-url')
  getDownloadUrl(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.kycService.getDownloadUrl(user, id);
  }

  @Roles(UserRole.ADMIN)
  @Get('reviews/pending')
  listPendingReviews(@Query() query: PaginationQueryDto) {
    return this.kycService.listPendingReviews(query);
  }

  @Roles(UserRole.ADMIN)
  @Get('reviews/:userId')
  getCleanerSubmission(@Param('userId', ParseUUIDPipe) userId: string) {
    return this.kycService.getStatus(userId);
  }

  @Roles(UserRole.ADMIN)
  @Patch('documents/:id/review')
  reviewDocument(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReviewDto,
  ) {
    return this.kycService.reviewDocument(admin, id, dto);
  }

  @Roles(UserRole.ADMIN)
  @Patch('reviews/:userId')
  reviewCleaner(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Body() dto: ReviewDto,
  ) {
    return this.kycService.reviewCleaner(admin, userId, dto);
  }
}
