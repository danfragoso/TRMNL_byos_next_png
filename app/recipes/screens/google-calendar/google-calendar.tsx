import { PreSatori } from "@/utils/pre-satori";

interface CalendarEvent {
	id: string;
	title: string;
	start: string; // ISO 8601 datetime
	end: string; // ISO 8601 datetime
	allDay?: boolean;
}

interface GoogleCalendarProps {
	events?: CalendarEvent[];
	startDate?: string; // ISO 8601 date for the start of the week
	width?: number;
	height?: number;
}

export default function GoogleCalendar({
	events = [],
	startDate,
	width = 800,
	height = 600,
}: GoogleCalendarProps) {
	// Get the start of the week (Monday)
	const getWeekStart = (date?: string) => {
		const d = date ? new Date(date) : new Date();
		const day = d.getDay();
		const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Adjust to Monday
		return new Date(d.setDate(diff));
	};

	const weekStart = getWeekStart(startDate);

	// Generate 7 days starting from weekStart
	const weekDays = Array.from({ length: 7 }, (_, i) => {
		const date = new Date(weekStart);
		date.setDate(weekStart.getDate() + i);
		return date;
	});

	// Format day header (e.g., "Mon 3/17")
	const formatDayHeader = (date: Date) => {
		const dayNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
		const dayName = dayNames[date.getDay()];
		const month = date.getMonth() + 1;
		const day = date.getDate();
		return `${dayName} ${month}/${day}`;
	};

	// Time slots from 7:00 AM to 8:00 PM (every 30 minutes)
	const timeSlots: Array<{ hour: number; minute: number }> = [];
	for (let hour = 7; hour <= 20; hour++) {
		for (let minute = 0; minute < 60; minute += 30) {
			timeSlots.push({ hour, minute });
		}
	}

	// Format time slot label
	const formatTime = (hour: number, minute: number) => {
		const period = hour >= 12 ? "pm" : "am";
		const displayHour = hour > 12 ? hour - 12 : hour === 0 ? 12 : hour;
		return minute === 0 ? `${displayHour}${period}` : "";
	};

	// Parse date string to local Date, handling timezone issues
	const parseEventDate = (dateString: string): Date => {
		// If it's just a date (YYYY-MM-DD), treat it as local time, not UTC
		if (dateString.length === 10 && dateString.match(/^\d{4}-\d{2}-\d{2}$/)) {
			const [year, month, day] = dateString.split('-').map(Number);
			return new Date(year, month - 1, day); // Month is 0-indexed
		}
		// Otherwise parse as normal (handles ISO datetime strings)
		return new Date(dateString);
	};

	// Check if date is same day
	const isSameDay = (date1: Date, date2: Date) => {
		return (
			date1.getFullYear() === date2.getFullYear() &&
			date1.getMonth() === date2.getMonth() &&
			date1.getDate() === date2.getDate()
		);
	};

	// Get events for a specific day
	const getEventsForDay = (date: Date) => {
		return events.filter((event) => {
			const eventStart = parseEventDate(event.start);
			return isSameDay(eventStart, date);
		});
	};

	// Get all-day events for a specific day
	const getAllDayEvents = (date: Date) => {
		return getEventsForDay(date).filter((event) => event.allDay);
	};

	// Get timed events for a specific day
	const getTimedEvents = (date: Date) => {
		return getEventsForDay(date).filter((event) => !event.allDay);
	};

	// Calculate event position and height
	const getEventStyle = (event: CalendarEvent) => {
		const start = parseEventDate(event.start);
		const end = parseEventDate(event.end);

		const startHour = start.getHours();
		const startMinute = start.getMinutes();
		const endHour = end.getHours();
		const endMinute = end.getMinutes();

		// Calculate position from 7:00 AM
		const startOffset = (startHour - 7) * 2 + (startMinute >= 30 ? 1 : 0);
		const endOffset = (endHour - 7) * 2 + (endMinute >= 30 ? 1 : 0);

		return {
			top: startOffset,
			height: Math.max(1, endOffset - startOffset),
		};
	};

	const columnWidth = width / 8; // 7 days + 1 time column
	const rowHeight = 20;
	const allDayRowHeight = 30;

	return (
		<PreSatori width={width} height={height}>
			<div className="flex flex-col w-full h-full bg-white text-black font-mono">
				{/* Header with days */}
				<div className="flex" style={{ borderBottom: "3px solid black" }}>
					<div style={{ width: columnWidth, borderRight: "3px solid black" }} />
					{weekDays.map((day, i) => (
						<div
							key={i}
							style={{ width: columnWidth, borderRight: "3px solid black", fontSize: "16px" }}
							className="p-1 text-center font-bold"
						>
							{formatDayHeader(day)}
						</div>
					))}
				</div>

				{/* All-day events row */}
				<div className="flex" style={{ minHeight: allDayRowHeight, borderBottom: "3px solid black" }}>
					<div
						style={{ width: columnWidth, borderRight: "3px solid black", fontSize: "14px" }}
						className="p-1 font-bold"
					>
						all-day
					</div>
					{weekDays.map((day, i) => {
						const allDayEvents = getAllDayEvents(day);
						return (
							<div
								key={i}
								style={{ width: columnWidth, borderRight: "3px solid black" }}
								className="p-1 relative"
							>
								{allDayEvents.map((event, j) => (
									<div
										key={j}
										className="bg-black text-white p-1 mb-1 overflow-hidden font-bold"
										style={{ maxHeight: "24px", fontSize: "13px" }}
									>
										{event.title}
									</div>
								))}
							</div>
						);
					})}
				</div>

				{/* Time grid */}
				<div className="flex-1 relative overflow-hidden">
					{/* Time labels */}
					<div className="absolute left-0 top-0">
						{timeSlots.map((slot, i) => {
							const label = formatTime(slot.hour, slot.minute);
							return (
								<div
									key={i}
									style={{
										width: columnWidth,
										height: rowHeight,
										borderRight: "3px solid black",
										borderBottom: "2px solid #666",
										fontSize: "14px",
										fontWeight: label ? "bold" : "normal",
									}}
									className="p-1"
								>
									{label}
								</div>
							);
						})}
					</div>

					{/* Day columns with events */}
					<div className="absolute" style={{ left: columnWidth, top: 0, right: 0 }}>
						<div className="flex">
							{weekDays.map((day, dayIndex) => {
								const timedEvents = getTimedEvents(day);
								return (
									<div
										key={dayIndex}
										style={{
											width: columnWidth,
											height: timeSlots.length * rowHeight,
											borderRight: "3px solid black",
										}}
										className="relative"
									>
										{/* Time slot grid lines */}
										{timeSlots.map((_, i) => (
											<div
												key={i}
												style={{
													height: rowHeight,
													borderBottom: "2px solid #666",
												}}
											/>
										))}

										{/* Events */}
										{timedEvents.map((event, eventIndex) => {
											const style = getEventStyle(event);
											return (
												<div
													key={eventIndex}
													className="absolute left-0 right-0 bg-black text-white p-1 overflow-hidden font-bold"
													style={{
														top: style.top * rowHeight,
														height: style.height * rowHeight,
														fontSize: "13px",
													}}
												>
													{event.title}
												</div>
											);
										})}
									</div>
								);
							})}
						</div>
					</div>
				</div>
			</div>
		</PreSatori>
	);
}
