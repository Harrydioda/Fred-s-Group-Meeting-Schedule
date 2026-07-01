const LOCATION_OPTIONS = [
  "",
  "Sinica/Online",
  "NTU",
  "NTHU/NYCU",
  "Online",
  "Sinica",
  "NTU Starbucks",
  "Holiday"
];

const STUDENT_LOCATION_OPTIONS = [
  "Sinica",
  "Online",
  "\u5be6\u9ad4"
];

const STUDENT_STATUS_OPTIONS = [
  "open",
  "pending",
  "skip"
];

const TIME_SLOTS = Array.from({ length: 25 }, (_, index) => {
  const startMinutes = 7 * 60 + 30 + index * 30;
  const endMinutes = startMinutes + 30;
  return `${formatSlotTime(startMinutes)}-${formatSlotTime(endMinutes)}`;
});

function formatSlotTime(totalMinutes) {
  const hours = Math.floor(totalMinutes / 60);
  const minutes = String(totalMinutes % 60).padStart(2, "0");
  return `${hours}:${minutes}`;
}

const DEFAULT_STUDENT_NAMES = [
  "Sourav",
  "\u90ed\u739f\u4f36",
  "\u5f90\u8a9e\u746d",
  "\u694a\u6df3\u5149",
  "\u9673\u598d\u541b",
  "\u99ac\u8587\u6b23",
  "Alice",
  "Alejandro",
  "Tim",
  "\u6c5f\u97cb\u7bc9",
  "\u9ec3\u9756\u96ef",
  "\u4f55\u4f9d\u975c",
  "\u5f35\u7440\u771f",
  "\u9ec3\u6021\u7444",
  "\u9673\u7fcc\u5ead",
  "\u694a\u5b50\u5afa",
  "\u675c\u5049\u797a",
  "\u53e4\u6052\u6600",
  "Saykat Dutta",
  "\u694a\u4ec1\u6a1e",
  "\u9ec3\u662d\u60e0",
  "\u5f35\u5bb9\u723e",
  "\u9ec3\u9e97\u860b",
  "\u67ef\u5ba5\u5be7",
  "\u9673\u59ff\u541f",
  "\u77f3\u6b3d\u923a",
  "\u5289\u6b23\u5e73",
  "\u8521\u5a9b\u5a9b",
  "\u9673\u5ead\u59a4",
  "\u838a\u9752\u8afa",
  "\u5ed6\u6021\u83ef",
  "\u674e\u7fbd\u59ff",
  "\u738b\u611b\u7433",
  "\u9673\u6021\u5747",
  "\u9ec3\u82e5\u5b89",
  "\u6e38\u55ac\u7fbd",
  "\u5433\u662d\u6cd3",
  "\u5289\u8a69\u742a"
];

const DEFAULT_STUDENTS = DEFAULT_STUDENT_NAMES.map(name => ({
  location: "Online",
  status: "open",
  name,
  note: ""
}));

const DEFAULT_WEEKS = {
  "2026-06-29": {
    locations: {
      "2026-06-29": "",
      "2026-06-30": "Online",
      "2026-07-01": "Sinica/Online",
      "2026-07-02": "NTHU/NYCU",
      "2026-07-03": "Sinica/Online",
      "2026-07-04": "",
      "2026-07-05": ""
    },
    slots: {
      "2026-06-29": {
        "7:30-8:00": "Not open",
        "8:00-8:30": "Not open"
      },
      "2026-06-30": {
        "8:00-8:30": "Not open",
        "11:00-11:30": "\u5289\u6b23\u5e73",
        "11:30-12:00": "\u90ed\u739f\u4f36",
        "12:00-12:30": "\u6c5f\u97cb\u7bc9",
        "12:30-13:00": "Sourav"
      },
      "2026-07-01": {
        "9:00-9:30": "\u9ec3\u6021\u7444",
        "9:30-10:00": "\u9673\u59ff\u541f",
        "10:00-10:30": "\u53e4\u6052\u6600",
        "10:30-11:00": "\u8521\u5a9b\u5a9b",
        "11:00-11:30": "\u5f35\u5bb9\u723e",
        "11:30-12:00": "\u9ec3\u9e97\u860b"
      },
      "2026-07-02": {
        "8:00-8:30": "Not open",
        "10:00-10:30": "\u9ec3\u82e5\u5b89",
        "11:00-11:30": "\u5433\u662d\u6cd3",
        "11:30-12:00": "\u5ed6\u6021\u83ef"
      },
      "2026-07-03": {
        "8:00-8:30": "Not open",
        "12:00-12:30": "\u838a\u9752\u8afa",
        "12:30-13:00": "Alice",
        "13:00-13:30": "\u694a\u6df3\u5149",
        "13:30-14:00": "\u694a\u5b50\u5afa",
        "14:00-14:30": "\u4f55\u4f9d\u975c",
        "14:30-15:00": "\u675c\u5049\u797a"
      },
      "2026-07-04": {},
      "2026-07-05": {}
    }
  }
};
