import { createHmac, timingSafeEqual } from 'node:crypto';
import type { PipelineStage, PipelineContext } from '../pipeline';
import type { Result } from '../result';
import { ok, err, ErrorCode } from '../result';

export class VerifySignatureStage implements PipelineStage {
  readonly name = 'verify-signature';

  async execute(ctx: PipelineContext): Promise<Result<PipelineContext>> {
    const secret = ctx.source?.webhookSecret;

    // If INTAKE_REQUIRE_HMAC is enabled globally, reject sources without a secret
    const requireHmac = process.env['INTAKE_REQUIRE_HMAC'] === 'true';
    if (!secret) {
      if (requireHmac) return err(ErrorCode.INVALID_SIGNATURE, 'This source has no webhook secret — INTAKE_REQUIRE_HMAC is enabled');
      return ok(ctx);
    }

    const signature = ctx.headers['x-webhook-signature'];
    if (!signature) {
      return err(ErrorCode.INVALID_SIGNATURE, 'Missing X-Webhook-Signature header');
    }

    if (!ctx.rawBody) {
      ctx.warnings.push('rawBody unavailable — skipping HMAC verification');
      return ok(ctx);
    }

    const expected = createHmac('sha256', secret)
      .update(ctx.rawBody)
      .digest('hex');

    const sigBuf = Buffer.from(signature.replace(/^sha256=/, ''));
    const expBuf = Buffer.from(expected);

    if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
      return err(ErrorCode.INVALID_SIGNATURE, 'Webhook signature verification failed');
    }

    return ok(ctx);
  }
}
