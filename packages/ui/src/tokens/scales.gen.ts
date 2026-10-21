// Committed design-token snapshot retained under the maintainer disposition in PROVENANCE.md.
// Theme-independent scales: typography, spacing, radii, z-index, motion, breakpoints, density.

export const scales = {
  "fontFamily": {
    "sans": "'Inter Variable', Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
    "mono": "'Jetbrains Mono', 'SF Mono', SFMono-Regular, ui-monospace, 'DejaVu Sans Mono', Menlo, Consolas, monospace"
  },
  "fontSize": [
    10,
    11,
    12,
    13,
    14,
    15,
    16,
    18,
    20,
    22,
    24,
    32
  ],
  "lineHeight": [
    12,
    14,
    16,
    18,
    20,
    24,
    28,
    36
  ],
  "fontWeight": {
    "regular": 400,
    "medium": 500,
    "semibold": 600
  },
  "letterSpacing": {
    "0": "0",
    "-0.02": "-0.02em",
    "-0.01": "-0.01em",
    "-0.005": "-0.005em",
    "0.02": "0.02em"
  },
  "underline": {
    "offset": "0.14em",
    "dashedThickness": "0.07em",
    "color": "stroke.secondaryTransparent"
  },
  "textStyles": {
    "heading": {
      "extraLarge": {
        "fontSize": 32,
        "lineHeight": 36,
        "fontWeight": 600,
        "letterSpacing": "-0.02em",
        "color": "content.primary"
      },
      "large": {
        "fontSize": 24,
        "lineHeight": 28,
        "fontWeight": 600,
        "letterSpacing": "-0.02em",
        "color": "content.primary"
      },
      "standard": {
        "fontSize": 20,
        "lineHeight": 24,
        "fontWeight": 600,
        "letterSpacing": "-0.02em",
        "color": "content.primary"
      },
      "medium": {
        "fontSize": 18,
        "lineHeight": 24,
        "fontWeight": 600,
        "letterSpacing": "-0.02em",
        "color": "content.primary"
      },
      "small": {
        "fontSize": 16,
        "lineHeight": 20,
        "fontWeight": 600,
        "letterSpacing": "-0.01em",
        "color": "content.primary"
      },
      "extraSmall": {
        "fontSize": 14,
        "lineHeight": 20,
        "fontWeight": 600,
        "letterSpacing": "0",
        "color": "content.primary"
      }
    },
    "body": {
      "large": {
        "fontSize": 16,
        "lineHeight": 20,
        "fontWeight": 500,
        "letterSpacing": "-0.005em",
        "color": "content.secondary"
      },
      "standard": {
        "fontSize": 14,
        "lineHeight": 20,
        "fontWeight": 500,
        "letterSpacing": "-0.005em",
        "color": "content.secondary"
      },
      "small": {
        "fontSize": 13,
        "lineHeight": 18,
        "fontWeight": 500,
        "letterSpacing": "-0.005em",
        "color": "content.secondary"
      },
      "strong": {
        "fontSize": 14,
        "lineHeight": 20,
        "fontWeight": 600,
        "letterSpacing": "-0.005em",
        "color": "content.secondary"
      },
      "link": {
        "fontSize": 14,
        "lineHeight": 20,
        "fontWeight": 500,
        "letterSpacing": "-0.005em",
        "color": "content.primary",
        "underline": "solid"
      },
      "interactive": {
        "fontSize": 14,
        "lineHeight": 20,
        "fontWeight": 600,
        "letterSpacing": "-0.005em",
        "color": "content.accent"
      },
      "preview": {
        "fontSize": 14,
        "lineHeight": 20,
        "fontWeight": 500,
        "letterSpacing": "-0.005em",
        "color": "content.secondary",
        "underline": "dashed"
      },
      "code": {
        "fontSize": 13,
        "lineHeight": 16,
        "fontWeight": 400,
        "letterSpacing": "0",
        "color": "content.secondary",
        "family": "mono"
      }
    },
    "text12": {
      "standard": {
        "fontSize": 12,
        "lineHeight": 16,
        "fontWeight": 500,
        "letterSpacing": "0",
        "color": "content.secondary"
      },
      "link": {
        "fontSize": 12,
        "lineHeight": 16,
        "fontWeight": 500,
        "letterSpacing": "0",
        "color": "content.secondary",
        "underline": "solid"
      },
      "preview": {
        "fontSize": 12,
        "lineHeight": 16,
        "fontWeight": 500,
        "letterSpacing": "0",
        "color": "content.secondary",
        "underline": "dashed"
      }
    },
    "text11": {
      "standard": {
        "fontSize": 11,
        "lineHeight": 16,
        "fontWeight": 500,
        "letterSpacing": "0",
        "color": "content.secondary"
      },
      "link": {
        "fontSize": 11,
        "lineHeight": 16,
        "fontWeight": 500,
        "letterSpacing": "0",
        "color": "content.secondary",
        "underline": "solid"
      },
      "small": {
        "fontSize": 10,
        "lineHeight": 14,
        "fontWeight": 500,
        "letterSpacing": "0",
        "color": "content.secondary"
      }
    }
  },
  "textColorVariants": {
    "on-accent": "content.onAccent",
    "primary": "content.primary",
    "secondary": "content.secondary",
    "tertiary": "content.tertiary",
    "placeholder": "content.tertiary",
    "negative": "content.critical",
    "positive": "content.success",
    "warning": "content.warning",
    "inverse": "content.inverse",
    "accent": "content.accent",
    "primary-on-contextual": "content.floatingPrimary",
    "secondary-on-contextual": "content.floatingSecondary",
    "tertiary-on-contextual": "content.floatingTertiary",
    "info": "content.info",
    "on-info-subtle": "content.onInfoSubtle"
  },
  "spacing": {
    "0": 0,
    "1": 1,
    "2": 2,
    "4": 4,
    "6": 6,
    "8": 8,
    "10": 10,
    "12": 12,
    "16": 16,
    "20": 20,
    "24": 24,
    "28": 28,
    "32": 32,
    "36": 36,
    "40": 40,
    "48": 48,
    "56": 56,
    "64": 64,
    "72": 72,
    "96": 96,
    "128": 128
  },
  "size": [
    0,
    2,
    4,
    6,
    8,
    10,
    12,
    16,
    20,
    24,
    28,
    32,
    36,
    40,
    48,
    64,
    72,
    96,
    128
  ],
  "radius": {
    "0": 0,
    "2": 2,
    "4": 4,
    "6": 6,
    "8": 8,
    "9": 9,
    "10": 10,
    "12": 12,
    "14": 14,
    "16": 16,
    "20": 20,
    "24": 24,
    "32": 32,
    "round": "50%",
    "squircleAvatar": "30%"
  },
  "controlRadius": {
    "20": 6,
    "22": 6,
    "28": 8,
    "32": 9,
    "34": 10,
    "36": 10,
    "40": 8
  },
  "surfaceRadius": {
    "menu/popover/dropdown/select/hover-card": 12,
    "menu item": 8,
    "tooltip": 8,
    "rich tooltip": 16,
    "toast": 8,
    "alert dialog": 12,
    "command palette / standalone dialog outer frame": 16,
    "dialog inner panel": 12,
    "card / highlight card": 12,
    "banner small/large": "12/16",
    "sidebar nav item": 9,
    "collapsed sidebar panel": 10,
    "checkbox 16/20": "6/8",
    "switch track": 16,
    "tag 20/22": "6/7",
    "chip": 7,
    "badge 16": 6,
    "kbd 14/16/18/20": "3/4/5/6",
    "floating action bar": 14
  },
  "zIndex": {
    "sidebar": 10,
    "modalLegacy": 1000,
    "resizeShield": 100001,
    "popoverTooltipDialog": 2147483646,
    "toast": 2147483647,
    "local": {
      "tableResizeHandle": 1,
      "tableDropIndicator": 2,
      "scrollbar": 3,
      "stickyMenuLabel": 1
    }
  },
  "duration": {
    "fast": 80,
    "comfortable": 140,
    "breezy": 200,
    "sluggish": 300,
    "sloth": 400
  },
  "easing": {
    "standard": "ease",
    "inOut": "ease-in-out",
    "tooltip": "cubic-bezier(0.7, 0, 0.39, 0.98)",
    "onboardingOut": "cubic-bezier(0.22, 1, 0.36, 1)",
    "onboardingInOut": "cubic-bezier(0.45, 0, 0.55, 1)",
    "linear": "linear"
  },
  "springs": {
    "onboardingPanel": {
      "type": "spring",
      "visualDuration": 0.48,
      "bounce": 0
    },
    "onboardingSoft": {
      "type": "spring",
      "visualDuration": 0.4,
      "bounce": 0.05
    },
    "onboardingPlayful": {
      "type": "spring",
      "visualDuration": 0.8,
      "bounce": 0.18
    },
    "onboardingStep": {
      "type": "spring",
      "visualDuration": 0.32,
      "bounce": 0
    },
    "videoPlayerControls": {
      "type": "spring",
      "stiffness": 500,
      "damping": 40,
      "mass": 1
    },
    "aiChatItem": {
      "type": "spring",
      "stiffness": 200,
      "damping": 25
    },
    "aiChatToolPill": {
      "type": "spring",
      "stiffness": 600,
      "damping": 20
    },
    "threadTitle": {
      "type": "spring",
      "stiffness": 150,
      "damping": 20
    },
    "workflowCanvas": {
      "type": "spring",
      "stiffness": 140,
      "damping": 26
    },
    "workflowStepper": {
      "type": "spring",
      "duration": 0.3,
      "bounce": 0
    },
    "onboardingAvatarStack": {
      "type": "spring",
      "stiffness": 170,
      "damping": 26
    },
    "onboardingIllustrationPop": {
      "type": "spring",
      "stiffness": 400,
      "damping": 25
    }
  },
  "breakpoints": {
    "xxs": 0,
    "xs": 320,
    "sm": 576,
    "md": 768,
    "lg": 992,
    "xl": 1200
  },
  "density": {
    "menuItemHeight": 32,
    "menuPadding": 4,
    "menuItemGap": 1,
    "controlHeights": {
      "button": [
        20,
        28,
        32,
        36
      ],
      "buttonDefault": 32,
      "buttonInToolbars": 28,
      "textInput": [
        28,
        32,
        34
      ],
      "selectTrigger": [
        20,
        22,
        28,
        32,
        36
      ],
      "boxedInput": 40,
      "chip": [
        20,
        22
      ],
      "tag": [
        20,
        22
      ],
      "badge": [
        14,
        16,
        20
      ],
      "kbd": [
        14,
        16,
        18,
        20
      ],
      "checkbox": [
        16,
        20
      ],
      "switchTrack": [
        "24x16",
        "30x20",
        "36x24"
      ],
      "segmentedControl": [
        28,
        32
      ]
    },
    "table": {
      "headerRow": 40,
      "bodyRow": 36,
      "footerRow": 36,
      "cellPaddingX": 12,
      "cellPaddingTop": 8,
      "checkbox": 16,
      "cellExpandMaxWidth": 350,
      "cellExpandMaxHeight": 200
    },
    "sidebar": {
      "width": 275,
      "minWidth": 200,
      "maxWidth": 350,
      "collapsedWidth": 0,
      "itemHeight": 28,
      "itemGap": 1,
      "itemRadius": 9,
      "itemPadding": "0 4px 0 8px",
      "headerHeight": 48,
      "autoHoverModeMaxWidth": 864
    },
    "topBar": {
      "height": 49,
      "paddingX": 12
    },
    "viewBar": {
      "height": 48,
      "paddingX": 12,
      "gap": 12
    },
    "recordPage": {
      "attributePanelWidthPercent": 30,
      "attributeRowHeight": 32,
      "attributeLabelWidth": 120,
      "tabsHeight": 28
    },
    "dialog": {
      "topOffset": "14vh",
      "commandPaletteWidth": 748,
      "createRecordWidth": 808,
      "alertDialogWidth": 440,
      "alertDialogWidthSmall": 320
    },
    "toast": {
      "minWidth": 300,
      "maxWidth": 350,
      "inset": 16,
      "insetMobile": 8
    },
    "settingsColumnMaxWidth": 768,
    "tooltipDelayMs": 600,
    "hoverCardDelayMs": {
      "open": 450,
      "close": 100
    },
    "hoverPopoverDelayMs": {
      "open": 500,
      "close": 250
    },
    "toastDurationMs": 4000
  }
} as const;
