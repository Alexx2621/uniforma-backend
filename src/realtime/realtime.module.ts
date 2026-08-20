import { Global, Module } from '@nestjs/common';
import { RealtimeRelayService } from './realtime-relay.service';

@Global()
@Module({
  providers: [RealtimeRelayService],
  exports: [RealtimeRelayService],
})
export class RealtimeModule {}
