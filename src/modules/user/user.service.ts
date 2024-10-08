import { Injectable } from '@nestjs/common';
import { CommandBus } from '@nestjs/cqrs';
import { InjectRepository } from '@nestjs/typeorm';
import { StorageService } from '@nhogs/nestjs-firebase';
import { plainToClass } from 'class-transformer';
import type { FindOptionsWhere } from 'typeorm';
import { Repository } from 'typeorm';
import { Transactional } from 'typeorm-transactional-cls-hooked';

import type { PageDto } from '../../common/dto/page.dto';
import { RoleType } from '../../constants';
import { FileNotImageException, UserNotFoundException } from '../../exceptions';
import { IFile } from '../../interfaces';
import { AwsS3Service } from '../../shared/services/aws-s3.service';
import { ValidatorService } from '../../shared/services/validator.service';
import { UserRegisterDto } from '../auth/dto/UserRegisterDto';
import { CreateSettingsCommand } from './commands/create-settings.command';
import { CreateSettingsDto } from './dtos/create-settings.dto';
import type { UserDto } from './dtos/user.dto';
import type { UsersPageOptionsDto } from './dtos/users-page-options.dto';
import { UserEntity } from './user.entity';
import type { UserSettingsEntity } from './user-settings.entity';

@Injectable()
export class UserService {
  constructor(
    @InjectRepository(UserEntity)
    private userRepository: Repository<UserEntity>,
    private validatorService: ValidatorService,
    private awsS3Service: AwsS3Service,
    private commandBus: CommandBus,
    private storageService: StorageService,
  ) {}

  /**
   * Find single user
   */
  findOne(findData: FindOptionsWhere<UserEntity>): Promise<UserEntity | null> {
    return this.userRepository.findOneBy(findData);
  }

  async findByUsernameOrEmail(
    options: Partial<{ username: string; email: string }>,
  ): Promise<UserEntity | null> {
    const queryBuilder = this.userRepository
      .createQueryBuilder('user')
      .leftJoinAndSelect<UserEntity, 'user'>('user.settings', 'settings');

    if (options.email) {
      queryBuilder.orWhere('user.email = :email', {
        email: options.email,
      });
    }

    if (options.username) {
      queryBuilder.orWhere('user.username = :username', {
        username: options.username,
      });
    }

    return queryBuilder.getOne();
  }

  @Transactional()
  async createUser(
    userRegisterDto: UserRegisterDto,
    file?: IFile,
  ): Promise<UserEntity> {
    const user = this.userRepository.create(userRegisterDto);

    if (file && !this.validatorService.isImage(file.mimetype)) {
      throw new FileNotImageException();
    }

    if (file) {
      const fileName = `${user.firstName}_${user.lastName}_${file.originalname}`;
      await this.storageService.uploadBytes(fileName, file.buffer);

      user.avatar = await this.storageService.getDownloadURL(fileName);
    }

    await this.userRepository.save(user);

    user.settings = await this.createSettings(
      user.id,
      plainToClass(CreateSettingsDto, {
        isEmailVerified: false,
        isPhoneVerified: false,
      }),
    );

    return user;
  }

  async getUsers(
    pageOptionsDto: UsersPageOptionsDto,
  ): Promise<PageDto<UserDto>> {
    const queryBuilder = this.userRepository.createQueryBuilder('user');
    const [items, pageMetaDto] = await queryBuilder.paginate(pageOptionsDto);

    return items.toPageDto(pageMetaDto);
  }

  async getUser(userId: Uuid): Promise<UserDto> {
    const queryBuilder = this.userRepository.createQueryBuilder('user');

    queryBuilder.where('user.id = :userId', { userId });

    const userEntity = await queryBuilder.getOne();

    if (!userEntity) {
      throw new UserNotFoundException();
    }

    return userEntity.toDto();
  }

  async createSettings(
    userId: Uuid,
    createSettingsDto: CreateSettingsDto,
  ): Promise<UserSettingsEntity> {
    return this.commandBus.execute<CreateSettingsCommand, UserSettingsEntity>(
      new CreateSettingsCommand(userId, createSettingsDto),
    );
  }

  async saveToken(
    user: UserEntity,
    hash: string,
    tokenExpiry: Date,
  ): Promise<UserDto> {
    user.token = hash;
    const userEntity = await this.userRepository.update(
      { id: user.id },
      { token: hash, tokenExpiry },
    );

    return userEntity.raw;
  }

  async savePassword(user: UserEntity, password: string): Promise<UserDto> {
    const userEntity = await this.userRepository.update(
      { id: user.id },
      { token: null!, tokenExpiry: null!, password },
    );

    return userEntity.raw;
  }

  /**
   * "Get the number of users with the role of USER."
   *
   * The first thing we do is create a query builder. This is a class that allows us to build a query. We pass in the name
   * of the entity we want to query, which is user
   * @returns The number of users in the database.
   */
  async getUserCount(): Promise<number> {
    const queryBuilder = this.userRepository.createQueryBuilder('user');

    queryBuilder.where('user.role = :role', { role: RoleType.USER });

    return queryBuilder.getCount();
  }

  /**
   * "Get the number of users with the role of admin."
   *
   * The first thing we do is create a query builder. This is a class that allows us to build a query. We pass in the name
   * of the entity we want to query, which is user
   * @returns The number of users with the role of admin.
   */
  async getAdminCount(): Promise<number> {
    const queryBuilder = this.userRepository.createQueryBuilder('user');

    queryBuilder.where('user.role = :role', { role: RoleType.ADMIN });

    return queryBuilder.getCount();
  }
}
