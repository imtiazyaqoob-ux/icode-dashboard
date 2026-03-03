# iCode Glen Ellyn — Calimatic Dashboard Project Notes

## API Endpoints

| Endpoint | Auth | Notes |
|---|---|---|
| `PublicAPI/GetAllStudentEnrollments?enrollmentType=0` | Public API Key | One record per student per enrollment |
| `PublicAPI/GetClassesDetailsInfo?CampusId=67` | Public API Key | One record per class session — primary source for capacity, schedule, dates |
| `PublicAPI/GetTransactionHistory` | Public API Key | All payment transactions |
| `Student/stats?franchiseIds=67` | Bearer token | Student count summary |
| `Lead/GetLeads?franchiseIds=67` | Bearer token | Full lead list |

**Auth header format for Public API:**
`Authorization: https://portal.icodeschool.com|YOUR_API_KEY`

---

## Confirmed Enrollment Record Fields (GetAllStudentEnrollments)

```json
{
  "action": "",
  "contactName": "Parent Name",
  "studentName": "Student Name",
  "studentStatus": false,
  "classType": "Belts",
  "classCategory": "Belt Program (Onsite)",
  "className": "Gray Belt",
  "course": "Gray Belt",
  "classStartDate": "February 7th, 2025",
  "classEndDate": null,
  "classId": null,
  "enrolledDate": "February 6th, 2025",
  "amountPaid": 100,
  "depositAmount": 100,
  "familyId": 43933,
  "studentId": 103997,
  "franchiseId": 67,
  "classTiming": null,
  "eventStartDate": null,
  "eventEndDate": null
}
```

### Key Gotchas on Enrollments
- **studentStatus is always false** for all records (belt and camp) — completely unreliable, ignore it
- **classId is always null** on enrollments — cannot join to the classes endpoint by ID
- **className has no session suffix** — "Gray Belt" not "Gray Belt - Sat - 25/26"
- **classTiming / classTimings are undefined** — time/day info does not exist on enrollment records
- **enrolledDate and classStartDate are ordinal strings** — "February 11th, 2026" — must use parseOrdinalDate() to parse, new Date() alone will fail

---

## Confirmed Class Record Fields (GetClassesDetailsInfo)

```json
{
  "classId": 26827,
  "className": "Foundation Belt",
  "classType": "Belts",
  "isActive": true,
  "daysOfWeek": "Saturdays",
  "timings": [{ "timeOfDay": "02:00 PM to 04:00 PM" }],
  "upcomingDates": [
    {
      "startDate": "2025-08-17T16:36:06.52",
      "endDate":   "2026-06-01T11:09:53.063"
    }
  ],
  "slots": {
    "totalSlots": 6,
    "availableSlots": 3,
    "canAddToWaitList": false,
    "waitListSlots": null
  },
  "price": 279.00,
  "salesPrice": "",
  "originalPrice": "279.00"
}
```

### Key Gotchas on Classes
- **upcomingDates contains objects {startDate, endDate}** — NOT raw date strings. Always access d.startDate / d.endDate, never new Date(d) directly
- **slots.totalSlots and slots.availableSlots** — confirmed field names. Old names total / available do NOT work
- **classStartDate / classEndDate are undefined** on the classes endpoint — dates only come from upcomingDates
- **classId is unique per session** — use this as the session key, not className + daysOfWeek (multiple sessions of the same belt can share the same day)
- **Enrolled count = totalSlots - availableSlots** — do not count enrollment records for capacity math

---

## Belt Enrollment Logic

### Session Strategy
- **Primary source: GetClassesDetailsInfo** — one record per session with real capacity and schedule
- **Session key: classId** — the only truly unique identifier per session
- **Schedule display:** daysOfWeek + timings[0].timeOfDay
- **Start/End dates:** parse from upcomingDates[0].startDate and upcomingDates[last].endDate
- **Enrolled count:** totalSlots - availableSlots
- **Active vs Completed:** isActive !== false AND upcomingDates[last].endDate > today

### Belt Student Definition (for LTV)
- A "belt student" = any student with at least one enrollment where classType === 'Belts'
- Do NOT use transaction enrollmentTypeName === 'classes' — unreliable

---

## Camp Enrollment Logic

### Deduplication
Calimatic sometimes creates duplicate enrollment records when a camp is cancelled and recreated. Deduplicate by studentName + className:
1. **If one record has a deposit and the other doesn't → keep the one with the deposit**
2. **If tied → keep the record with the later enrolledDate** (use parseOrdinalDate())

### Balance / Payment Fields
- **depositAmount** = deposit paid so far
- **amountPaid** = total collected to date
- **totalPrice** = from GetClassesDetailsInfo via _classPriceMap[className]
- **Balance = totalPrice - amountPaid**
- **Treat balance <= $10 as $0** (rounding/discount residuals)
- **Balance due date = camp start date - 14 days** (ignore the paymentDate field)
- Highlight balance due date in red if date has passed and balance > 0

---

## Revenue / Price Map

Build _classPriceMap at render time from state.classes:

```javascript
state._classPriceMap = {};
state.classes.forEach(cl => {
  const price = (cl.salesPrice > 0 ? cl.salesPrice : null) || cl.price || cl.originalPrice || 0;
  if (price > 0) state._classPriceMap[cl.className] = Number(price);
});
```

Price as of this session: $279/month for all belt levels.

---

## Useful Debug Endpoints (server.js)

| URL | What it shows |
|---|---|
| localhost:3000/debug | API probe — tests all endpoints, shows field names and record counts |
| localhost:3000/debug/enrollments | studentStatus distribution, belt active vs total, sample records |
| localhost:3000/debug/camps | Camp class names, upcomingDates counts, slot data |
| localhost:3000/debug/campdata | Raw camp enrollment fields — all columns |
| localhost:3000/debug/prices | Camp class prices from GetClassesDetailsInfo |

---

## Franchise / Config
- **Franchise ID:** 67
- **Campus ID:** 67
- **Domain:** https://portal.icodeschool.com
- **API Base:** https://api.calimatic.com/api
