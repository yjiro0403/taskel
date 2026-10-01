import {
    hasRelativeExpression,
    hasScheduleChange,
    hasTentativeWording,
    mentionsNonTokyoZone,
    mentionsNotificationTime,
} from '@/lib/schedule/phrases';
import {
    isValidTimeZone,
    parseWeekdayLabel,
    resolveWallTime,
    weekdayOfDate,
} from '@/lib/schedule/time';
import type { ReviewReason, ScheduleCandidate, SchedulePolicy } from '@/lib/schedule/types';

export interface PolicyContext {
    now: Date;
    autoRegisterEnabled: boolean;
    /** The user's original text, when the intake was text. Image intakes pass null. */
    sourceText?: string | null;
    /** Model notes about the whole image. Never used as a schedule fact. */
    imageNotes?: string | null;
}

function unique(reasons: ReviewReason[]): ReviewReason[] {
    return [...new Set(reasons)];
}

function evidenceOf(candidate: ScheduleCandidate, context: PolicyContext): string {
    return [context.sourceText, context.imageNotes, candidate.sourceEvidence, ...candidate.uncertainties]
        .filter((part): part is string => Boolean(part))
        .join('\n');
}

/**
 * Decide whether one normalized candidate may be written without a person confirming it.
 * A default end time is never treated as an explicit end.
 */
export function reasonsForCandidate(candidate: ScheduleCandidate, context: PolicyContext): ReviewReason[] {
    const reasons: ReviewReason[] = [];
    const evidence = evidenceOf(candidate, context);

    if (candidate.uncertainties.length > 0) {
        reasons.push('ambiguous_time');
    }
    if (candidate.status !== 'confirmed') {
        reasons.push('not_confirmed');
    }
    if (hasRelativeExpression(evidence)) {
        reasons.push('relative_expression');
    }
    if (hasScheduleChange(evidence)) {
        reasons.push('conversation_change');
    }
    if (hasTentativeWording(evidence)) {
        reasons.push('tentative');
    }
    if (mentionsNotificationTime(evidence) || candidate.uncertainties.some((item) => mentionsNotificationTime(item))) {
        reasons.push('notification_time');
    }
    if (!candidate.explicit.title || !candidate.title) {
        reasons.push('missing_title');
    }
    if (!candidate.explicit.year) {
        reasons.push('missing_year');
    }
    if (!candidate.explicit.month || !candidate.explicit.day || !candidate.date) {
        reasons.push('missing_date');
    }
    if (candidate.allDay) {
        reasons.push('all_day');
    }
    if (!candidate.allDay && (!candidate.explicit.startTime || !candidate.startTime)) {
        reasons.push('missing_start');
    }
    if (!candidate.allDay && (!candidate.explicit.endTime || !candidate.endTime)) {
        reasons.push('missing_end');
    }

    const zoneText = `${candidate.sourceEvidence}\n${context.sourceText ?? ''}\n${context.imageNotes ?? ''}`;
    if (!isValidTimeZone(candidate.timeZone)) {
        reasons.push('timezone_uncertain');
    } else if (candidate.timeZoneSource !== 'explicit' && mentionsNonTokyoZone(zoneText)) {
        reasons.push('timezone_uncertain');
    } else if (candidate.explicit.timezone && candidate.timeZoneSource !== 'explicit') {
        reasons.push('timezone_uncertain');
    }

    const labeledWeekday = parseWeekdayLabel(candidate.weekdayLabel);
    if (candidate.date && labeledWeekday !== null) {
        const actual = weekdayOfDate(candidate.date, candidate.timeZone);
        if (actual === null || actual !== labeledWeekday) {
            reasons.push('weekday_mismatch');
        }
    }

    if (
        !candidate.allDay
        && candidate.date
        && candidate.startTime
        && candidate.endTime
        && isValidTimeZone(candidate.timeZone)
    ) {
        const start = resolveWallTime(candidate.date, candidate.startTime, candidate.timeZone);
        const end = resolveWallTime(candidate.date, candidate.endTime, candidate.timeZone);
        if (!start.ok || !end.ok) {
            const failure = !start.ok ? start : end;
            reasons.push(!failure.ok && failure.reason === 'invalid' ? 'ambiguous_time' : 'dst_gap');
        } else if (end.utc.getTime() <= start.utc.getTime()) {
            reasons.push('end_not_after_start');
        } else if (start.utc.getTime() < context.now.getTime()) {
            reasons.push('past_date');
        }
    } else if (candidate.allDay && candidate.date && isValidTimeZone(candidate.timeZone)) {
        const noon = resolveWallTime(candidate.date, '12:00', candidate.timeZone);
        if (noon.ok && noon.utc.getTime() < context.now.getTime() - 12 * 60 * 60 * 1000) {
            reasons.push('past_date');
        }
    }

    return unique(reasons);
}

export function decideSchedulePolicy(
    candidates: ScheduleCandidate[],
    context: PolicyContext,
): SchedulePolicy {
    if (candidates.length === 0) {
        return {
            eligibleForAuto: false,
            autoRegister: false,
            reasons: ['unreadable'],
            candidate: null,
        };
    }

    if (candidates.length !== 1) {
        const perItem = candidates.flatMap((candidate) => reasonsForCandidate(candidate, context));
        return {
            eligibleForAuto: false,
            autoRegister: false,
            reasons: unique(['multiple_items', ...perItem]),
            candidate: null,
        };
    }

    const candidate = candidates[0];
    const reasons = reasonsForCandidate(candidate, context);
    const eligibleForAuto = reasons.length === 0;
    if (!eligibleForAuto) {
        return {
            eligibleForAuto: false,
            autoRegister: false,
            reasons,
            candidate,
        };
    }
    if (!context.autoRegisterEnabled) {
        return {
            eligibleForAuto: true,
            autoRegister: false,
            reasons: ['auto_register_off'],
            candidate,
        };
    }
    return {
        eligibleForAuto: true,
        autoRegister: true,
        reasons: [],
        candidate,
    };
}
