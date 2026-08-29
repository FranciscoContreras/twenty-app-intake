import type { PipelineStage, PipelineContext } from '../pipeline';
import type { Result } from '../result';
import { ok, err, ErrorCode } from '../result';
import { scoreSpam, describeVerdict } from '../spam';
import { honeypotField, spamFilterEnabled, spamScoreThreshold } from '../settings';

/**
 * Holds a payload that looks automated, before anything is written.
 *
 * Placed after normalization so the scoring sees canonical names — `email`
 * rather than whichever of nine spellings the form used — and before schema sync
 * so a bot cannot extend the workspace's schema or mint a Person, Company,
 * Opportunity and Note on its way to being noticed. That ordering is the whole
 * point: quarantine that runs after the writes is just a slower cleanup job.
 *
 * The payload is not discarded. It is recorded with its score and its reasons,
 * and an operator can release it, which re-runs it with the filter overruled.
 */
export class QuarantineStage implements PipelineStage {
  readonly name = 'quarantine';

  async execute(ctx: PipelineContext): Promise<Result<PipelineContext>> {
    const honeypot = ctx.source?.honeypotField || honeypotField();
    const filterOn = spamFilterEnabled();

    // Nothing configured and the filter off — no work, and no cost.
    if (!honeypot && !filterOn) return ok(ctx);

    const verdict = scoreSpam(ctx.flat ?? {}, honeypot);
    const next = { ...ctx, spam: verdict };

    if (ctx.skipSpamFilter) {
      if (verdict.score > 0) {
        next.warnings.push(`Spam filter overruled by release — score was ${verdict.score}: ${describeVerdict(verdict)}`);
      }
      return ok(next);
    }

    // The honeypot is decisive on its own. Scoring is not: it only acts when the
    // workspace has switched the filter on, so upgrading to 0.4.0 cannot start
    // silently withholding leads from anyone who did not ask for it.
    const quarantine = verdict.honeypot || (filterOn && verdict.score >= spamScoreThreshold());

    if (quarantine) {
      return err(
        ErrorCode.QUARANTINED,
        verdict.honeypot
          ? 'Honeypot field was filled — payload quarantined'
          : `Spam score ${verdict.score} met the threshold of ${spamScoreThreshold()} — payload quarantined`,
        { spamScore: verdict.score, reason: describeVerdict(verdict), signals: verdict.signals },
      );
    }

    if (verdict.score > 0) {
      next.warnings.push(`Spam score ${verdict.score} (below threshold): ${describeVerdict(verdict)}`);
    }

    return ok(next);
  }
}
