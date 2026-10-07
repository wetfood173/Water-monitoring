/**
 * ค่ามาตรฐานของหน้า Dashboard — snapshot จากค่าที่ใช้งานจริงเมื่อ 2026-10-07
 * ใช้เป็นค่าเริ่มต้นทั้งตอน seed ฐานข้อมูลใหม่ (server/db/seed.js) และตอนกด "คืนค่าเริ่มต้น" บนหน้าเว็บ
 * ค่าที่แอดมินแก้จากหน้าเว็บภายหลังเก็บใน app_settings และไม่ถูกเขียนทับตอน restart
 */

export const STANDARD_VISIBLE_CARDS = {
  "chart": false,
  "alarms": true,
  "diagram": true,
  "instruments": true
};

export const STANDARD_HIDDEN_TAGS = [];

export const STANDARD_LAYOUT = {
  "items": [
    {
      "h": 14,
      "w": 12,
      "x": 0,
      "y": 0,
      "type": "diagram",
      "title": "Utility | Dashboard",
      "titleBold": true
    },
    {
      "h": 4,
      "w": 3,
      "x": 0,
      "y": 14,
      "tag": "TT-TANK5",
      "type": "bar",
      "titleBold": false,
      "valueBold": true
    },
    {
      "h": 4,
      "w": 3,
      "x": 3,
      "y": 14,
      "tag": "FT-600Q",
      "type": "bar"
    },
    {
      "h": 4,
      "w": 3,
      "x": 6,
      "y": 14,
      "tag": "PT-AIR",
      "type": "bar"
    },
    {
      "h": 4,
      "w": 3,
      "x": 9,
      "y": 14,
      "tag": "PT-STM",
      "type": "bar"
    },
    {
      "h": 8,
      "w": 12,
      "x": 0,
      "y": 18,
      "type": "alarms"
    }
  ]
};

export const STANDARD_DIAGRAM = {
  "items": [
    {
      "h": 155,
      "w": 134,
      "x": 662,
      "y": 170,
      "id": "tank-2",
      "kind": "tank",
      "pond": "2"
    },
    {
      "h": 155,
      "w": 134,
      "x": 494,
      "y": 170,
      "id": "tank-3",
      "kind": "tank",
      "pond": "3"
    },
    {
      "h": 155,
      "w": 134,
      "x": 326,
      "y": 170,
      "id": "tank-4",
      "kind": "tank",
      "pond": "4"
    },
    {
      "h": 155,
      "w": 134,
      "x": 158,
      "y": 170,
      "id": "tank-5",
      "kind": "tank",
      "pond": "5"
    },
    {
      "h": 62,
      "w": 134,
      "x": 830,
      "y": 170,
      "id": "tank-1B",
      "kind": "tank",
      "pond": "1B",
      "fontSize": 13
    },
    {
      "h": 62,
      "w": 134,
      "x": 830,
      "y": 262,
      "id": "tank-1A",
      "kind": "tank",
      "pond": "1A",
      "fontSize": 13
    },
    {
      "h": 200,
      "w": 170,
      "x": 230,
      "y": 430,
      "id": "tank-600Q",
      "kind": "tank",
      "pond": "600Q",
      "fontSize": 15
    },
    {
      "h": 26,
      "w": 130,
      "x": 328,
      "y": 10,
      "id": "eq-0",
      "kind": "equip",
      "label": "Retort F–N"
    },
    {
      "h": 26,
      "w": 130,
      "x": 671,
      "y": 10,
      "id": "eq-1",
      "kind": "equip",
      "label": "Retort A–E"
    },
    {
      "h": 26,
      "w": 124,
      "x": 460,
      "y": 47,
      "id": "eq-2",
      "kind": "equip",
      "label": "Cooling Tower"
    },
    {
      "h": 26,
      "w": 100,
      "x": 590,
      "y": 93,
      "id": "eq-3",
      "kind": "equip",
      "label": "Cooling Tower"
    },
    {
      "h": 120,
      "w": 110,
      "x": 1000,
      "y": 187,
      "id": "softener",
      "kind": "softener"
    },
    {
      "w": 110,
      "x": 10,
      "y": 210,
      "id": "tap-TT-05",
      "tag": "TT-TANK5",
      "kind": "tap",
      "color": "#E08A4F",
      "label": "อุณหภูมิน้ำ · TT-TANK5"
    },
    {
      "w": 140,
      "x": 80,
      "y": 450,
      "id": "tap-FT-600Q",
      "tag": "FT-600Q",
      "kind": "tap",
      "color": "#5B9BD5",
      "label": "อัตราไหลขาเข้า · FT-600Q",
      "fontSize": 10
    },
    {
      "w": 254,
      "x": 520,
      "y": 430,
      "id": "dial-PT-AIR",
      "tag": "PT-AIR",
      "kind": "dial",
      "color": "#8FB9DC",
      "hidden": true
    },
    {
      "w": 254,
      "x": 790,
      "y": 430,
      "id": "dial-PT-STM",
      "tag": "PT-STM",
      "kind": "dial",
      "color": "#C9A227",
      "hidden": true
    },
    {
      "w": 112,
      "x": 990,
      "y": 73,
      "id": "tap-muntjm8vek4",
      "tag": "FI-SOFT",
      "bold": false,
      "kind": "tap",
      "label": "Flow rate ขาเข้า",
      "hidden": true
    },
    {
      "w": 112,
      "x": 990,
      "y": 343,
      "id": "copy-muntman9yr0",
      "tag": "FO-SOFT",
      "bold": false,
      "kind": "tap",
      "color": "#0000ff",
      "label": "Flow rate ขาออก",
      "hidden": true
    }
  ],
  "pipes": [
    {
      "id": "pipe-0",
      "pts": [
        [
          230,
          170
        ],
        [
          230,
          60
        ],
        [
          905,
          60
        ],
        [
          905,
          166
        ]
      ],
      "style": "flow"
    },
    {
      "id": "pipe-1",
      "pts": [
        [
          725,
          170
        ],
        [
          725,
          110
        ],
        [
          553,
          110
        ],
        [
          553,
          166
        ]
      ],
      "style": "flow"
    },
    {
      "id": "pipe-2",
      "pts": [
        [
          393,
          36
        ],
        [
          393,
          166
        ]
      ],
      "style": "flow"
    },
    {
      "id": "pipe-3",
      "pts": [
        [
          739,
          36
        ],
        [
          739,
          166
        ]
      ],
      "style": "flow"
    },
    {
      "id": "pipe-4",
      "pts": [
        [
          730,
          350
        ],
        [
          730,
          380
        ],
        [
          390,
          380
        ],
        [
          390,
          350
        ]
      ],
      "style": "flow"
    },
    {
      "id": "pipe-5",
      "pts": [
        [
          326,
          245
        ],
        [
          300,
          245
        ]
      ],
      "style": "flow"
    },
    {
      "id": "pipe-6",
      "pts": [
        [
          662,
          245
        ],
        [
          636,
          245
        ]
      ],
      "style": "flow"
    },
    {
      "id": "pipe-7",
      "pts": [
        [
          830,
          201
        ],
        [
          804,
          201
        ]
      ],
      "style": "flow"
    },
    {
      "id": "pipe-8",
      "pts": [
        [
          998,
          201
        ],
        [
          972,
          201
        ]
      ],
      "style": "flow"
    },
    {
      "id": "pipe-9",
      "pts": [
        [
          998,
          293
        ],
        [
          972,
          293
        ]
      ],
      "style": "flow"
    },
    {
      "id": "pipe-10",
      "pts": [
        [
          80,
          540
        ],
        [
          226,
          540
        ]
      ],
      "style": "flow"
    },
    {
      "id": "link-0",
      "pts": [
        [
          126,
          247
        ],
        [
          156,
          247
        ]
      ],
      "style": "dashed"
    },
    {
      "id": "pipe-muntl09z21e",
      "pts": [
        [
          1050,
          147
        ],
        [
          1050,
          177
        ]
      ],
      "style": "flow",
      "hidden": true
    },
    {
      "id": "pipe-muntlwo3hyv",
      "pts": [
        [
          1050,
          304
        ],
        [
          1050,
          334
        ]
      ],
      "style": "flow",
      "hidden": true
    }
  ]
};
