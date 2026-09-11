import type { SVGProps } from "react";

const base = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  viewBox: "0 0 24 24",
};

type P = SVGProps<SVGSVGElement>;

export const ArcReactor = (p: P) => (
  <svg {...base} {...p}>
    <circle cx="12" cy="12" r="9" />
    <circle cx="12" cy="12" r="4.6" />
    <circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none" />
    <path d="M12 3v3M12 18v3M3 12h3M18 12h3" />
  </svg>
);

export const ChatIcon = (p: P) => (
  <svg {...base} {...p}>
    <path d="M20 15a2 2 0 0 1-2 2H8l-4 4V5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2z" />
  </svg>
);

export const LibraryIcon = (p: P) => (
  <svg {...base} {...p}>
    <path d="M4 4h5a2 2 0 0 1 2 2v13a1.5 1.5 0 0 0-1.5-1.5H4z" />
    <path d="M20 4h-5a2 2 0 0 0-2 2v13a1.5 1.5 0 0 1 1.5-1.5H20z" />
  </svg>
);

export const BrainIcon = (p: P) => (
  <svg {...base} {...p}>
    <path d="M9.5 3.5A2.5 2.5 0 0 0 7 6a2.5 2.5 0 0 0-1.5 4.5A2.5 2.5 0 0 0 7 15a2.5 2.5 0 0 0 2.5 2.5V3.5z" />
    <path d="M14.5 3.5A2.5 2.5 0 0 1 17 6a2.5 2.5 0 0 1 1.5 4.5A2.5 2.5 0 0 1 17 15a2.5 2.5 0 0 1-2.5 2.5V3.5z" />
    <path d="M12 17.5v3" />
  </svg>
);

export const HomeIcon = (p: P) => (
  <svg {...base} {...p}>
    <path d="M3 10.5 12 3l9 7.5" />
    <path d="M5.5 9.5V20h13V9.5" />
  </svg>
);

export const MicIcon = (p: P) => (
  <svg {...base} {...p}>
    <rect x="9" y="2.5" width="6" height="11" rx="3" />
    <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21" />
  </svg>
);

export const SendIcon = (p: P) => (
  <svg {...base} {...p}>
    <path d="M4.5 12 20 4.5 15.5 20l-4-6.5z" />
    <path d="M11.5 13.5 20 4.5" />
  </svg>
);

export const StopIcon = (p: P) => (
  <svg {...base} {...p}>
    <rect x="6.5" y="6.5" width="11" height="11" rx="2" />
  </svg>
);

export const SpeakerIcon = (p: P) => (
  <svg {...base} {...p}>
    <path d="M4 9.5h3.5L12 5.5v13L7.5 14.5H4z" />
    <path d="M16 9a4 4 0 0 1 0 6" />
    <path d="M18.5 6.5a7.5 7.5 0 0 1 0 11" />
  </svg>
);

export const MuteIcon = (p: P) => (
  <svg {...base} {...p}>
    <path d="M4 9.5h3.5L12 5.5v13L7.5 14.5H4z" />
    <path d="m16.5 9.5 4 5M20.5 9.5l-4 5" />
  </svg>
);

export const DumbbellIcon = (p: P) => (
  <svg {...base} {...p}>
    <path d="M3 9v6M6 7.5v9M18 7.5v9M21 9v6M6 12h12" />
  </svg>
);

export const PotIcon = (p: P) => (
  <svg {...base} {...p}>
    <path d="M4 9h16v6a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4z" />
    <path d="M2.5 9h19M9 5.5V3M15 5.5V3" />
  </svg>
);

export const CalendarIcon = (p: P) => (
  <svg {...base} {...p}>
    <rect x="3.5" y="5" width="17" height="15.5" rx="2" />
    <path d="M3.5 10h17M8 3v4M16 3v4" />
  </svg>
);

export const BookIcon = (p: P) => (
  <svg {...base} {...p}>
    <path d="M5 4h9a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z" />
    <path d="M17 7h2v13H8" />
  </svg>
);

export const NoteIcon = (p: P) => (
  <svg {...base} {...p}>
    <path d="M5.5 3.5h9L19 8v12.5H5.5z" />
    <path d="M14 3.5V8h4.5M9 12.5h6M9 16h4" />
  </svg>
);

export const PinIcon = (p: P) => (
  <svg {...base} {...p}>
    <path d="M9 3.5h6l-.8 5.2 3.3 3.3H6.5l3.3-3.3z" />
    <path d="M12 12v8.5" />
  </svg>
);

export const CheckIcon = (p: P) => (
  <svg {...base} {...p}>
    <path d="m5 12.5 4.5 4.5L19 7" />
  </svg>
);

export const PlusIcon = (p: P) => (
  <svg {...base} {...p}>
    <path d="M12 5v14M5 12h14" />
  </svg>
);

export const TrashIcon = (p: P) => (
  <svg {...base} {...p}>
    <path d="M4.5 6.5h15M9.5 6.5V4h5v2.5M6.5 6.5 7.5 20h9l1-13.5" />
  </svg>
);

export const SearchIcon = (p: P) => (
  <svg {...base} {...p}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m16 16 4.5 4.5" />
  </svg>
);

export const PeopleIcon = (p: P) => (
  <svg {...base} {...p}>
    <circle cx="9" cy="8" r="3.2" />
    <path d="M3.5 19.5c0-3 2.5-5 5.5-5s5.5 2 5.5 5" />
    <path d="M16 5.6a3.2 3.2 0 0 1 0 6.3M17.5 14.8c2 .6 3.3 2.4 3.3 4.7" />
  </svg>
);

export const LogoutIcon = (p: P) => (
  <svg {...base} {...p}>
    <path d="M14.5 4.5h4.5v15h-4.5" />
    <path d="M3.5 12h10.5M10.5 8.2 14.3 12l-3.8 3.8" />
  </svg>
);

export const HistoryIcon = (p: P) => (
  <svg {...base} {...p}>
    <path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1" />
    <path d="M3.5 4.5V9H8" />
    <path d="M12 7.8V12l3 1.8" />
  </svg>
);

export const CameraIcon = (p: P) => (
  <svg {...base} {...p}>
    <path d="M3.5 8.5h3l1.5-2.5h8L17.5 8.5h3v11h-17z" />
    <circle cx="12" cy="13.5" r="3.5" />
  </svg>
);

export const BellIcon = (p: P) => (
  <svg {...base} {...p}>
    <path d="M6.5 9.5a5.5 5.5 0 0 1 11 0c0 4 1.5 5.5 1.5 5.5H5s1.5-1.5 1.5-5.5z" />
    <path d="M10.2 18.5a2 2 0 0 0 3.6 0" />
  </svg>
);

export const AlertIcon = (p: P) => (
  <svg {...base} {...p}>
    <path d="M12 4.5 21 19.5H3z" />
    <path d="M12 10v4M12 16.8v.2" />
  </svg>
);

export const InfoIcon = (p: P) => (
  <svg {...base} {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 11v5.5M12 7.8v.2" />
  </svg>
);

export const SparkIcon = (p: P) => (
  <svg {...base} {...p}>
    <path d="M12 3.5 13.9 9l5.6 1.9-5.6 1.9L12 18.4l-1.9-5.6L4.5 10.9 10.1 9z" />
    <path d="M18.5 3.5v3M20 5h-3" />
  </svg>
);

export const ArrowIcon = (p: P) => (
  <svg {...base} {...p}>
    <path d="M5 12h13M13 6.5 18.5 12 13 17.5" />
  </svg>
);

export const GearIcon = (p: P) => (
  <svg {...base} {...p}>
    <circle cx="12" cy="12" r="3.2" />
    <path d="M19.4 13.5a1.7 1.7 0 0 0 .34 1.88l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1.03 1.56V21a2 2 0 1 1-4 0v-.1A1.7 1.7 0 0 0 8.9 19.3a1.7 1.7 0 0 0-1.88.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.7 1.7 0 0 0 .34-1.88 1.7 1.7 0 0 0-1.56-1.03H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.56-1.13 1.7 1.7 0 0 0-.34-1.88l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.88.34H9.1a1.7 1.7 0 0 0 1.03-1.56V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1.03 1.56 1.7 1.7 0 0 0 1.88-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.88v.06a1.7 1.7 0 0 0 1.56 1.03H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1.03z" />
  </svg>
);

export const XIcon = (p: P) => (
  <svg {...base} {...p}>
    <path d="m6.5 6.5 11 11M17.5 6.5l-11 11" />
  </svg>
);

export const PAGE_ICONS = {
  workout: DumbbellIcon,
  recipe: PotIcon,
  plan: CalendarIcon,
  guide: BookIcon,
  note: NoteIcon,
} as const;
