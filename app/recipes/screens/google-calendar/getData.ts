import { unstable_cache } from "next/cache";

export const dynamic = "force-dynamic";

interface CalendarEvent {
	id: string;
	title: string;
	start: string;
	end: string;
	allDay?: boolean;
}

interface CalendarParams {
	calendarId?: string;
	apiKey?: string;
	icalUrl?: string;
	maxResults?: number;
}

interface GoogleCalendarEvent {
	id: string;
	summary: string;
	start: {
		dateTime?: string;
		date?: string;
		timeZone?: string;
	};
	end: {
		dateTime?: string;
		date?: string;
		timeZone?: string;
	};
}

interface GoogleCalendarResponse {
	items?: GoogleCalendarEvent[];
}

/**
 * Parse iCal format and extract events
 */
async function fetchICalEvents(icalUrl: string): Promise<CalendarEvent[] | null> {
	try {
		const response = await fetch(icalUrl, {
			headers: {
				Accept: "text/calendar",
			},
			next: { revalidate: 0 },
		});

		if (!response.ok) {
			throw new Error(`iCal fetch responded with status: ${response.status}`);
		}

		const icalData = await response.text();
		const events: CalendarEvent[] = [];

		// Simple iCal parser - split by VEVENT blocks
		const eventBlocks = icalData.split("BEGIN:VEVENT");

		for (let i = 1; i < eventBlocks.length; i++) {
			const block = eventBlocks[i];
			const endIndex = block.indexOf("END:VEVENT");
			if (endIndex === -1) continue;

			const eventData = block.substring(0, endIndex);

			// Extract fields using regex
			const summaryMatch = eventData.match(/SUMMARY:(.+)/);
			const startMatch = eventData.match(/DTSTART[;:](.+)/);
			const endMatch = eventData.match(/DTEND[;:](.+)/);
			const uidMatch = eventData.match(/UID:(.+)/);

			if (!startMatch || !endMatch) continue;

			const summary = summaryMatch ? summaryMatch[1].trim() : "Untitled Event";
			let startStr = startMatch[1].trim();
			let endStr = endMatch[1].trim();
			const uid = uidMatch ? uidMatch[1].trim() : `event-${i}`;

			// Handle VALUE=DATE format (all-day events)
			const isAllDay = startStr.length === 8; // YYYYMMDD format

			// Parse date/datetime
			const parseICalDate = (dateStr: string): string => {
				// Remove VALUE=DATE: prefix if present
				dateStr = dateStr.replace(/^[^:]*:/, "");

				if (dateStr.length === 8) {
					// All-day event: YYYYMMDD
					const year = dateStr.substring(0, 4);
					const month = dateStr.substring(4, 6);
					const day = dateStr.substring(6, 8);
					return `${year}-${month}-${day}`;
				} else {
					// DateTime: YYYYMMDDTHHMMSS or YYYYMMDDTHHMMSSZ
					const year = dateStr.substring(0, 4);
					const month = dateStr.substring(4, 6);
					const day = dateStr.substring(6, 8);
					const hour = dateStr.substring(9, 11);
					const minute = dateStr.substring(11, 13);
					const second = dateStr.substring(13, 15);
					return `${year}-${month}-${day}T${hour}:${minute}:${second}`;
				}
			};

			events.push({
				id: uid,
				title: summary,
				start: parseICalDate(startStr),
				end: parseICalDate(endStr),
				allDay: isAllDay,
			});
		}

		return events;
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error);
		if (
			errorMessage.includes("prerender") ||
			errorMessage.includes("HANGING_PROMISE_REJECTION") ||
			errorMessage.includes("prerender is complete")
		) {
			return null;
		}
		console.error("Error fetching iCal events:", error);
		return null;
	}
}

/**
 * Get the start and end of the current week (Monday to Sunday)
 */
function getWeekBounds() {
	const now = new Date();
	const day = now.getDay();
	const diff = now.getDate() - day + (day === 0 ? -6 : 1); // Adjust to Monday

	const weekStart = new Date(now);
	weekStart.setDate(diff);
	weekStart.setHours(0, 0, 0, 0);

	const weekEnd = new Date(weekStart);
	weekEnd.setDate(weekStart.getDate() + 7);
	weekEnd.setHours(23, 59, 59, 999);

	return {
		timeMin: weekStart.toISOString(),
		timeMax: weekEnd.toISOString(),
	};
}

/**
 * Fetch calendar events from Google Calendar API
 */
async function fetchCalendarEvents(
	calendarId: string,
	apiKey: string,
	maxResults: number = 50,
): Promise<CalendarEvent[] | null> {
	try {
		const { timeMin, timeMax } = getWeekBounds();

		const url = new URL(
			`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`,
		);
		url.searchParams.append("key", apiKey);
		url.searchParams.append("timeMin", timeMin);
		url.searchParams.append("timeMax", timeMax);
		url.searchParams.append("maxResults", maxResults.toString());
		url.searchParams.append("singleEvents", "true");
		url.searchParams.append("orderBy", "startTime");

		const response = await fetch(url.toString(), {
			headers: {
				Accept: "application/json",
			},
			next: { revalidate: 0 },
		});

		if (!response.ok) {
			throw new Error(
				`Google Calendar API responded with status: ${response.status}`,
			);
		}

		const data: GoogleCalendarResponse = await response.json();

		if (!data.items || data.items.length === 0) {
			return [];
		}

		// Transform Google Calendar events to our format
		const events: CalendarEvent[] = data.items.map((event) => {
			const isAllDay = Boolean(event.start.date);
			const start = event.start.dateTime || event.start.date || "";
			const end = event.end.dateTime || event.end.date || "";

			return {
				id: event.id,
				title: event.summary || "Untitled Event",
				start,
				end,
				allDay: isAllDay,
			};
		});

		return events;
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error);
		if (
			errorMessage.includes("prerender") ||
			errorMessage.includes("HANGING_PROMISE_REJECTION") ||
			errorMessage.includes("prerender is complete")
		) {
			return null;
		}
		console.error("Error fetching calendar events:", error);
		return null;
	}
}

/**
 * Fetch calendar data without caching
 */
async function fetchCalendarDataNoCache(params?: CalendarParams) {
	const icalUrl = params?.icalUrl || process.env.GOOGLE_CALENDAR_ICAL_URL;
	const calendarId = params?.calendarId || "primary";
	const apiKey = params?.apiKey || process.env.GOOGLE_CALENDAR_API_KEY || "";
	const maxResults = params?.maxResults || 50;

	let events: CalendarEvent[] | null = null;

	// Prefer iCal URL if provided
	if (icalUrl) {
		events = await fetchICalEvents(icalUrl);
	} else if (apiKey) {
		events = await fetchCalendarEvents(calendarId, apiKey, maxResults);
	} else {
		console.warn(
			"Neither iCal URL nor Google Calendar API key provided. Set GOOGLE_CALENDAR_ICAL_URL or GOOGLE_CALENDAR_API_KEY environment variable.",
		);
	}

	if (!events) {
		return {
			events: [],
			startDate: new Date().toISOString(),
		};
	}

	// Filter events to current week only
	const { timeMin, timeMax } = getWeekBounds();
	const weekStart = new Date(timeMin);
	const weekEnd = new Date(timeMax);

	const filteredEvents = events.filter((event) => {
		const eventStart = new Date(event.start);
		return eventStart >= weekStart && eventStart <= weekEnd;
	});

	return {
		events: filteredEvents,
		startDate: timeMin,
	};
}

/**
 * Cached calendar data fetcher
 */
const getCachedCalendarData = unstable_cache(
	async (params?: CalendarParams) => {
		const icalUrl = params?.icalUrl || process.env.GOOGLE_CALENDAR_ICAL_URL;
		const calendarId = params?.calendarId || "primary";
		const apiKey = params?.apiKey || process.env.GOOGLE_CALENDAR_API_KEY || "";
		const maxResults = params?.maxResults || 50;

		let events: CalendarEvent[] | null = null;

		// Prefer iCal URL if provided
		if (icalUrl) {
			events = await fetchICalEvents(icalUrl);
		} else if (apiKey) {
			events = await fetchCalendarEvents(calendarId, apiKey, maxResults);
		} else {
			throw new Error("No calendar source provided - skip caching");
		}

		if (!events) {
			throw new Error("Empty or invalid data - skip caching");
		}

		// Filter events to current week only
		const { timeMin, timeMax } = getWeekBounds();
		const weekStart = new Date(timeMin);
		const weekEnd = new Date(timeMax);

		const filteredEvents = events.filter((event) => {
			const eventStart = new Date(event.start);
			return eventStart >= weekStart && eventStart <= weekEnd;
		});

		return {
			events: filteredEvents,
			startDate: timeMin,
		};
	},
	["google-calendar-data"],
	{
		tags: ["google-calendar"],
		revalidate: 300, // Cache for 5 minutes
	},
);

/**
 * Main export function
 */
export default async function getData(params?: CalendarParams) {
	try {
		return await getCachedCalendarData(params);
	} catch (error) {
		console.log("Cache skipped or error:", error);
		return fetchCalendarDataNoCache(params);
	}
}
