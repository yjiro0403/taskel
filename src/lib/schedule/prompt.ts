/**
 * The model only returns JSON. It must not call a calendar API.
 * Current time is context for the reviewer, not permission to invent a year.
 */
export function buildExtractionPrompt(nowIso: string, defaultTimeZone: string): string {
    return [
        'You extract schedule candidates from a message or a single image.',
        'Return only the structured object. Do not invent facts that are not written.',
        `The current instant is ${nowIso}. The default time zone is ${defaultTimeZone}.`,
        'Distinguish three clocks: when the image was sent or captured, a chat or notification timestamp, and the event start. Only the event start is a schedule time.',
        'Ignore status-bar clocks, "sent" times, read receipts, and notification arrival times. If one of those could be confused with the event, add that to uncertainties and set status to candidate.',
        'If the year, month, day, start, end, or title is not explicitly written, set that explicit flag to false and leave the value null. Do not fill a missing year from the current date.',
        'Relative words such as 今日, 明日, 来週, tomorrow, or a weekday without a calendar date are not an explicit date. Put the words in uncertainties.',
        'If the text changes the plan ("火曜で" then "木曜に変更") and the final date and time are not both written as a finished decision, status must be candidate or unknown.',
        'A tentative, TBD, or 調整中 plan is not confirmed.',
        'allDay is true only when the source says the event lasts all day or gives a date with no clock time and calls it an all-day plan. A missing end time is not all-day and is not a default duration.',
        'timezone is an IANA name only when the source states a zone or a place. Otherwise null and explicit.timezone false.',
        'date is YYYY-MM-DD, startTime and endTime are HH:mm in that zone, 24-hour. Do not output seconds.',
        'sourceEvidence is a short quote from the source that supports the candidate. Do not add names that are not required to identify the event title.',
        'One image can contain several candidates. Return every distinct candidate. Do not merge them and do not drop alternatives.',
        'status confirmed means a single finished decision with an explicit calendar date, start, and end. Otherwise candidate or unknown.',
        'imageNotes is a short note about unreadable areas or ignored clocks. It is not a schedule.',
    ].join('\n');
}
