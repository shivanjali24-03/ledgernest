import { Module } from '@nestjs/common';
import { ApprovalGate } from './approval-gate.js';

@Module({ providers: [ApprovalGate], exports: [ApprovalGate] })
export class ApprovalGateModule {}
