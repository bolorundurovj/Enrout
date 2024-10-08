import {
  Body,
  Controller,
  Delete,
  Get,
  Patch,
  Post,
  Query,
  UploadedFile,
} from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';

import type { PageDto } from '../../common/dto/page.dto';
import { PageOptionsDto } from '../../common/dto/page-options.dto';
import { DocumentState, RoleType } from '../../constants';
import { ApiFile, Auth, AuthUser, UUIDParam } from '../../decorators';
import { IFile } from '../../interfaces';
import { MailService } from '../../mail/mail.service';
import { NotificationService } from '../../shared/services/notification.service';
import { IUnifiedUser } from '../auth/jwt.strategy';
import { DocumentService } from '../document/document.service';
import type { DocumentDto } from '../document/dto/document.dto';
import { RejectDocumentDto } from '../document/dto/reject-document.dto';
import { RequestChangesDto } from '../document/dto/rquest-changes.dto';
import { SetWorkflowDto } from '../document/dto/set-workfloe.dto';
import { UpdateDocumentDto } from '../document/dto/update-document.dto';
import { StudentEntity } from '../student/entities/student.entity';
import { StudentService } from '../student/student.service';
import { CreateStaffDto } from './dto/create-staff.dto';
import { ForwardDocumentDto } from './dto/forward-document.dto';
import type { StaffDto } from './dto/staff.dto';
import { StatisticsDto } from './dto/statistics.dto';
import { UpdateStaffDto } from './dto/update-staff.dto';
import { StaffEntity } from './entities/staff.entity';
import { StaffService } from './staff.service';

@Controller('staff')
@ApiTags('Staff')
export class StaffController {
  constructor(
    private readonly staffService: StaffService,
    private readonly documentService: DocumentService,
    private readonly mailService: MailService,
    private readonly studentService: StudentService,
    private readonly notificationService: NotificationService,
  ) {}

  @Post()
  @Auth([RoleType.ADMIN])
  async create(@Body() createStaffDto: CreateStaffDto) {
    const staffEntity = await this.staffService.create(createStaffDto);

    return staffEntity.toDto({ isActive: true });
  }

  @Get()
  @Auth([RoleType.ADMIN])
  async findAll(
    @Query() pageOptionsDto: PageOptionsDto,
  ): Promise<PageDto<StaffDto>> {
    return this.staffService.findAll(pageOptionsDto);
  }

  @Get('/documents')
  @Auth([RoleType.STAFF])
  async findAllDocs(
    @Query() pageOptionsDto: PageOptionsDto,
    @AuthUser() user: StudentEntity,
  ): Promise<PageDto<DocumentDto>> {
    return this.documentService.findStaffAssignedDocs(user.id, pageOptionsDto);
  }

  @Get('/dashboard-stats')
  @ApiOkResponse({ type: StatisticsDto, description: 'Staff Statistics' })
  @Auth([RoleType.STAFF])
  async getDashboardStats(
    @AuthUser() user: StaffEntity,
  ): Promise<StatisticsDto> {
    return this.documentService.getStaffStatistics(user.id);
  }

  @Get(':id')
  @Auth([RoleType.ADMIN])
  async findOne(@UUIDParam('id') id: Uuid): Promise<StaffDto> {
    const staffEntity = await this.staffService.findById(id);

    return staffEntity.toDto({ isActive: true });
  }

  @Patch(':id')
  @Auth([RoleType.ADMIN])
  async update(
    @UUIDParam('id') id: Uuid,
    @Body() updateStaffDto: UpdateStaffDto,
  ): Promise<StaffDto> {
    const staffEntity = await this.staffService.update(id, updateStaffDto);

    return staffEntity.toDto({ isActive: true });
  }

  @Delete(':id')
  @Auth([RoleType.ADMIN])
  async remove(@UUIDParam('id') id: Uuid): Promise<StaffDto> {
    const staffEntity = await this.staffService.remove(id);

    return staffEntity.toDto({ isActive: true });
  }

  @Get('/documents/:id')
  @Auth([RoleType.STAFF])
  async findOneDoc(
    @UUIDParam('id') id: Uuid,
    @AuthUser() user: StudentEntity | StaffEntity,
  ): Promise<DocumentDto> {
    const docEntity = await this.documentService.staffFindOne(user.id, id);

    return docEntity.toDto();
  }

  @Patch('documents/:id')
  @Auth([RoleType.STAFF])
  async updateDOc(
    @UUIDParam('id') id: Uuid,
    @Body() updateDocumentDto: UpdateDocumentDto,
    @AuthUser() user: StudentEntity | StaffEntity,
  ): Promise<DocumentDto> {
    const docEntity = await this.documentService.updateStaffAssignedDoc(
      user.id,
      id,
      updateDocumentDto,
    );

    await this.notificationService.createNotification(
      `Updated Document`,
      `Update Document with ID: ${docEntity.id}`,
      user.id,
    );

    return docEntity.toDto();
  }

  @Patch('documents/:id/approve')
  @ApiFile({ name: 'document' })
  @Auth([RoleType.STAFF])
  async forwardDoc(
    @UUIDParam('id') id: Uuid,
    @Body() body: ForwardDocumentDto,
    @AuthUser() user: IUnifiedUser,
    @UploadedFile() file?: IFile,
  ): Promise<DocumentDto> {
    const docEntity = await this.documentService.forwardDocument(
      user.id,
      user.departmentId! as Uuid,
      user.designation!,
      id,
      body.comment,
      file,
    );

    await this.notificationService.createNotification(
      `Approved Document`,
      `Approved Document with ID: ${docEntity.id}`,
      user.id,
    );

    if (docEntity.state === DocumentState.APPROVED) {
      const studentEntity = await this.studentService.findById(
        docEntity.ownerId,
      );

      await this.notificationService.createNotification(
        `Approved Document`,
        `Document ${docEntity.title} with ID: ${docEntity.id} has been approved`,
        studentEntity.id,
      );

      await this.mailService.documentApproved({
        to: studentEntity.email,
        data: {
          name: `${studentEntity.firstName} ${studentEntity.lastName}`,
          docTitle: docEntity.title,
        },
      });
    } else {
      const staffEntity = await this.staffService.findById(
        docEntity.currentlyAssignedId,
      );

      await this.notificationService.createNotification(
        `Forwarded Document`,
        `Document with ID: ${docEntity.id} requires your attention`,
        staffEntity.id,
      );

      await this.mailService.forwardedDocument({
        to: staffEntity.email,
        data: {
          name: `${user.firstName} ${user.lastName}`,
          docTitle: docEntity.title,
        },
      });
    }

    return docEntity.toDto();
  }

  @Patch('documents/:id/reject')
  @Auth([RoleType.STAFF])
  async rejectDoc(
    @UUIDParam('id') id: Uuid,
    @AuthUser() user: IUnifiedUser,
    @Body() body: RejectDocumentDto,
  ): Promise<DocumentDto> {
    const docEntity = await this.documentService.rejectDocument(
      user.id,
      user.departmentId! as Uuid,
      user.designation!,
      id,
      body.comment,
    );

    docEntity.reviewerComment = body.comment;

    await this.notificationService.createNotification(
      `Rejected Document`,
      `Rejected Document with ID: ${docEntity.id}`,
      user.id,
    );

    if (docEntity.state === DocumentState.REJECTED) {
      const studentEntity = await this.studentService.findById(
        docEntity.ownerId,
      );

      await this.notificationService.createNotification(
        `Rejected Document`,
        `Your document ${docEntity.title} with ID: ${docEntity.id} has been rejected`,
        studentEntity.id,
      );

      await this.mailService.docRejectedMail({
        to: studentEntity.email,
        data: {
          docTitle: docEntity.title,
          reason: docEntity.reviewerComment,
        },
      });
    } else {
      const staffEntity = await this.staffService.findById(
        docEntity.currentlyAssignedId,
      );

      await this.notificationService.createNotification(
        `Rejected Document`,
        `Document with ID: ${docEntity.id} requires your attention`,
        staffEntity.id,
      );

      await this.mailService.docRejectedMail({
        to: staffEntity.email,
        data: {
          docTitle: docEntity.title,
          reason: docEntity.reviewerComment,
        },
      });
    }

    return docEntity.toDto();
  }

  @Patch('documents/:id/request-changes')
  @Auth([RoleType.STAFF])
  async requestChangesOnDoc(
    @UUIDParam('id') id: Uuid,
    @AuthUser() user: StudentEntity | StaffEntity,
    @Body() body: RequestChangesDto,
  ): Promise<DocumentDto> {
    const docEntity = await this.documentService.requestChangesOnDocument(
      user.id,
      id,
      body.comment,
    );

    const studentEntity = await this.studentService.findById(docEntity.ownerId);

    await this.notificationService.createNotification(
      `Changes Requested`,
      `Changes Requested on Document with ID: ${docEntity.id}`,
      user.id,
    );

    await this.notificationService.createNotification(
      `Changes Requested`,
      `Your document ${docEntity.title} with ID: ${docEntity.id} needs some changes`,
      studentEntity.id,
    );

    await this.mailService.changeRequestedMail({
      to: studentEntity.email,
      data: {
        docTitle: docEntity.title,
      },
    });

    return docEntity.toDto();
  }

  @Patch('documents/:id/set-workflow')
  @Auth([RoleType.STAFF])
  async setDocWorkflow(
    @UUIDParam('id') id: Uuid,
    @AuthUser() user: StudentEntity | StaffEntity,
    @Body() body: SetWorkflowDto,
  ): Promise<DocumentDto> {
    const docEntity = await this.documentService.setDocumentWorkflow(
      user.id,
      id,
      body.workflowId,
    );

    await this.notificationService.createNotification(
      `Document Workflow`,
      `Set Workflow for Document with ID: ${docEntity.id}. Workflow ID: ${body.workflowId}`,
      user.id,
    );

    return docEntity.toDto();
  }
}
