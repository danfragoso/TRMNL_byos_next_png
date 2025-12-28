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
	const calendarId = params?.calendarId || "primary";
	const apiKey = params?.apiKey || process.env.GOOGLE_CALENDAR_API_KEY || "";
	const maxResults = params?.maxResults || 50;

	if (!apiKey) {
		console.warn(
			"Google Calendar API key not provided. Set GOOGLE_CALENDAR_API_KEY environment variable or pass apiKey parameter.",
		);
		return {
			events: [],
			startDate: new Date().toISOString(),
		};
	}

	const events = await fetchCalendarEvents(calendarId, apiKey, maxResults);

	if (!events) {
		return {
			events: [],
			startDate: new Date().toISOString(),
		};
	}

	const { timeMin } = getWeekBounds();

	return {
		events,
		startDate: timeMin,
	};
}

/**
 * Cached calendar data fetcher
 */
const getCachedCalendarData = unstable_cache(
	async (params?: CalendarParams) => {
		const calendarId = params?.calendarId || "primary";
		const apiKey = params?.apiKey || process.env.GOOGLE_CALENDAR_API_KEY || "";
		const maxResults = params?.maxResults || 50;

		if (!apiKey) {
			throw new Error("API key not provided - skip caching");
		}

		const events = await fetchCalendarEvents(calendarId, apiKey, maxResults);

		if (!events) {
			throw new Error("Empty or invalid data - skip caching");
		}

		const { timeMin } = getWeekBounds();

		return {
			events,
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
