import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import type { Env } from '../config/env.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { PasswordService } from './password.service.js';
import { MailModule } from '../mail/mail.module.js';

@Module({
  imports: [
    MailModule,
    JwtModule.registerAsync({
      global: true,
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        secret: config.get('JWT_ACCESS_SECRET', { infer: true }),
        signOptions: { algorithm: 'HS256', issuer: 'ledgernest' },
        verifyOptions: { algorithms: ['HS256'], issuer: 'ledgernest' },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, PasswordService],
  exports: [AuthService],
})
export class AuthModule {}
