import { Controller, Get, Param } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { GeoService } from './geo.service.js';

/** Place lookups for address forms. Anyone signed in may use them (setting up an organisation needs them too). */
@ApiTags('geo')
@ApiBearerAuth()
@Controller('geo')
export class GeoController {
  constructor(private readonly geo: GeoService) {}

  @Get('pincode/:pin')
  @Throttle({ default: { ttl: 60_000, limit: 60 } })
  @ApiOkResponse({
    description:
      'The PIN code’s state (from the GST list), district, towns and localities, from India Post',
  })
  pincode(@Param('pin') pin: string) {
    return this.geo.pincode(pin);
  }

  @Get('ifsc/:ifsc')
  @Throttle({ default: { ttl: 60_000, limit: 60 } })
  @ApiOkResponse({
    description:
      'The bank, branch and address for an IFSC, from Razorpay’s IFSC directory (the RBI list)',
  })
  ifsc(@Param('ifsc') ifsc: string) {
    return this.geo.ifsc(ifsc);
  }
}
