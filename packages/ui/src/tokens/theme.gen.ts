// Committed design-token snapshot. Source provenance must be resolved before public release.
// Theme axes, accent and elevated-surface overrides, elevation shadows.

export const identities = [
  "light",
  "dark",
  "hacker"
] as const;
export const accentColors = [
  "blue",
  "cyan",
  "yellow",
  "orange",
  "pink",
  "purple",
  "green"
] as const;
export const surfaceModes = [
  "base",
  "elevated"
] as const;
export const defaultAccent = "blue" as const;

/** Applied for every accent other than blue (tokens.md §2). */
export const accentOverrides = {
  "cyan": {
    "light": {
      "interactive": {
        "primary": "#00b9eb",
        "primaryHover": "#0d99bd",
        "selected": "#00b9eb1a",
        "selectedSubtle": "#00b9eb0d",
        "selectedStrong": "#00b9eb33"
      },
      "content": {
        "accent": "#0d99bd",
        "accentHover": "#0d99bd",
        "onAccentSubtle": "#056c87"
      },
      "stroke": {
        "accent": "#00b9eb",
        "accentMedium": "#00b9eb66",
        "accentSubtle": "#00b9eb1a"
      },
      "surface": {
        "accent": "#00b9eb",
        "accentSubtle": "#00b9eb1a"
      }
    },
    "dark": {
      "interactive": {
        "primary": "#0d99bd",
        "primaryHover": "#00b9eb",
        "selected": "#0d99bd1a",
        "selectedSubtle": "#0d99bd0d",
        "selectedStrong": "#0d99bd33"
      },
      "content": {
        "accent": "#40cff5",
        "accentHover": "#00b9eb",
        "onAccentSubtle": "#a9ebfc"
      },
      "stroke": {
        "accent": "#0d99bd",
        "accentMedium": "#0d99bd66",
        "accentSubtle": "#0d99bd1a"
      },
      "surface": {
        "accent": "#0d99bd",
        "accentSubtle": "#0d99bd1a"
      }
    },
    "hacker": {
      "interactive": {
        "primary": "#02ad6e",
        "primaryHover": "#00d17e",
        "selected": "#02ad6e1a",
        "selectedSubtle": "#02ad6e0d",
        "selectedStrong": "#02ad6e33"
      },
      "content": {
        "accent": "#a7f2cf",
        "accentHover": "#00d17e"
      },
      "stroke": {
        "accent": "#02ad6e",
        "accentMedium": "#02ad6e66",
        "accentSubtle": "#02ad6e1a"
      },
      "surface": {
        "accent": "#02ad6e",
        "accentSubtle": "#02ad6e1a"
      }
    }
  },
  "yellow": {
    "light": {
      "interactive": {
        "primary": "#f5a300",
        "primaryHover": "#cf8300",
        "selected": "#f5a3001a",
        "selectedSubtle": "#f5a3000d",
        "selectedStrong": "#f5a30033"
      },
      "content": {
        "accent": "#cf8300",
        "accentHover": "#cf8300",
        "onAccentSubtle": "#874d00"
      },
      "stroke": {
        "accent": "#f5a300",
        "accentMedium": "#f5a30066",
        "accentSubtle": "#f5a3001a"
      },
      "surface": {
        "accent": "#f5a300",
        "accentSubtle": "#f5a3001a"
      }
    },
    "dark": {
      "interactive": {
        "primary": "#cf8300",
        "primaryHover": "#f5a300",
        "selected": "#cf83001a",
        "selectedSubtle": "#cf83000d",
        "selectedStrong": "#cf830033"
      },
      "content": {
        "accent": "#f5a300",
        "accentHover": "#f5a300",
        "onAccentSubtle": "#ffd269"
      },
      "stroke": {
        "accent": "#cf8300",
        "accentMedium": "#cf830066",
        "accentSubtle": "#cf83001a"
      },
      "surface": {
        "accent": "#cf8300",
        "accentSubtle": "#cf83001a"
      }
    },
    "hacker": {
      "interactive": {
        "primary": "#b06a00",
        "primaryHover": "#f5a300",
        "selected": "#b06a001a",
        "selectedSubtle": "#b06a000d",
        "selectedStrong": "#b06a0033"
      },
      "content": {
        "accent": "#f5a300",
        "accentHover": "#f5a300",
        "onAccentSubtle": "#ffd269"
      },
      "stroke": {
        "accent": "#b06a00",
        "accentMedium": "#b06a0066",
        "accentSubtle": "#b06a001a"
      },
      "surface": {
        "accent": "#b06a00",
        "accentSubtle": "#b06a001a"
      }
    }
  },
  "orange": {
    "light": {
      "interactive": {
        "primary": "#f97514",
        "primaryHover": "#c95908",
        "selected": "#f975141a",
        "selectedSubtle": "#f975140d",
        "selectedStrong": "#f9751433"
      },
      "content": {
        "accent": "#c95908",
        "accentHover": "#c95908",
        "onAccentSubtle": "#9e3f00"
      },
      "stroke": {
        "accent": "#f97514",
        "accentMedium": "#f9751466",
        "accentSubtle": "#f975141a"
      },
      "surface": {
        "accent": "#f97514",
        "accentSubtle": "#f975141a"
      }
    },
    "dark": {
      "interactive": {
        "primary": "#c95908",
        "primaryHover": "#f97514",
        "selected": "#c959081a",
        "selectedSubtle": "#c959080d",
        "selectedStrong": "#c9590833"
      },
      "content": {
        "accent": "#ff9340",
        "accentHover": "#f97514",
        "onAccentSubtle": "#ffc89e"
      },
      "stroke": {
        "accent": "#c95908",
        "accentMedium": "#c9590866",
        "accentSubtle": "#c959081a"
      },
      "surface": {
        "accent": "#c95908",
        "accentSubtle": "#c959081a"
      }
    },
    "hacker": {
      "interactive": {
        "primary": "#02ad6e",
        "primaryHover": "#00d17e",
        "selected": "#02ad6e1a",
        "selectedSubtle": "#02ad6e0d",
        "selectedStrong": "#02ad6e33"
      },
      "content": {
        "accent": "#4ad99a",
        "accentHover": "#00d17e"
      },
      "stroke": {
        "accent": "#02ad6e",
        "accentMedium": "#02ad6e66",
        "accentSubtle": "#02ad6e1a"
      },
      "surface": {
        "accent": "#02ad6e",
        "accentSubtle": "#02ad6e1a"
      }
    }
  },
  "pink": {
    "light": {
      "interactive": {
        "primary": "#fa4b94",
        "primaryHover": "#e0387e",
        "selected": "#fa4b941a",
        "selectedSubtle": "#fa4b940d",
        "selectedStrong": "#fa4b9433"
      },
      "content": {
        "accent": "#e0387e",
        "accentHover": "#e0387e",
        "onAccentSubtle": "#b81c5d"
      },
      "stroke": {
        "accent": "#fa4b94",
        "accentMedium": "#fa4b9466",
        "accentSubtle": "#fa4b941a"
      },
      "surface": {
        "accent": "#fa4b94",
        "accentSubtle": "#fa4b941a"
      }
    },
    "dark": {
      "interactive": {
        "primary": "#e0387e",
        "primaryHover": "#fa4b94",
        "selected": "#e0387e1a",
        "selectedSubtle": "#e0387e0d",
        "selectedStrong": "#e0387e33"
      },
      "content": {
        "accent": "#ff73ad",
        "accentHover": "#fa4b94",
        "onAccentSubtle": "#ffbfda"
      },
      "stroke": {
        "accent": "#e0387e",
        "accentMedium": "#e0387e66",
        "accentSubtle": "#e0387e1a"
      },
      "surface": {
        "accent": "#e0387e",
        "accentSubtle": "#e0387e1a"
      }
    },
    "hacker": {
      "interactive": {
        "primary": "#02ad6e",
        "primaryHover": "#00d17e",
        "selected": "#02ad6e1a",
        "selectedSubtle": "#02ad6e0d",
        "selectedStrong": "#02ad6e33"
      },
      "content": {
        "accent": "#4ad99a",
        "accentHover": "#00d17e"
      },
      "stroke": {
        "accent": "#02ad6e",
        "accentMedium": "#02ad6e66",
        "accentSubtle": "#02ad6e1a"
      },
      "surface": {
        "accent": "#02ad6e",
        "accentSubtle": "#02ad6e1a"
      }
    }
  },
  "purple": {
    "light": {
      "interactive": {
        "primary": "#9b69ff",
        "primaryHover": "#864aff",
        "selected": "#9b69ff1a",
        "selectedSubtle": "#9b69ff0d",
        "selectedStrong": "#9b69ff33"
      },
      "content": {
        "accent": "#864aff",
        "accentHover": "#864aff",
        "onAccentSubtle": "#6238b5"
      },
      "stroke": {
        "accent": "#9b69ff",
        "accentMedium": "#9b69ff66",
        "accentSubtle": "#9b69ff1a"
      },
      "surface": {
        "accent": "#9b69ff",
        "accentSubtle": "#9b69ff1a"
      }
    },
    "dark": {
      "interactive": {
        "primary": "#864aff",
        "primaryHover": "#9b69ff",
        "selected": "#864aff1a",
        "selectedSubtle": "#864aff0d",
        "selectedStrong": "#864aff33"
      },
      "content": {
        "accent": "#b28cff",
        "accentHover": "#9b69ff",
        "onAccentSubtle": "#d8c4ff"
      },
      "stroke": {
        "accent": "#864aff",
        "accentMedium": "#864aff66",
        "accentSubtle": "#864aff1a"
      },
      "surface": {
        "accent": "#864aff",
        "accentSubtle": "#864aff1a"
      }
    },
    "hacker": {
      "interactive": {
        "primary": "#02ad6e",
        "primaryHover": "#00d17e",
        "selected": "#02ad6e1a",
        "selectedSubtle": "#02ad6e0d",
        "selectedStrong": "#02ad6e33"
      },
      "content": {
        "accent": "#4ad99a",
        "accentHover": "#00d17e"
      },
      "stroke": {
        "accent": "#02ad6e",
        "accentMedium": "#02ad6e66",
        "accentSubtle": "#02ad6e1a"
      },
      "surface": {
        "accent": "#02ad6e",
        "accentSubtle": "#02ad6e1a"
      }
    }
  },
  "green": {
    "light": {
      "interactive": {
        "primary": "#00d17e",
        "primaryHover": "#02ad6e",
        "selected": "#00d17e1a",
        "selectedSubtle": "#00d17e0d",
        "selectedStrong": "#00d17e33"
      },
      "content": {
        "accent": "#02ad6e",
        "accentHover": "#02ad6e",
        "onAccentSubtle": "#007d53"
      },
      "stroke": {
        "accent": "#00d17e",
        "accentMedium": "#00d17e66",
        "accentSubtle": "#00d17e1a"
      },
      "surface": {
        "accent": "#00d17e",
        "accentSubtle": "#00d17e1a"
      }
    },
    "dark": {
      "interactive": {
        "primary": "#02ad6e",
        "primaryHover": "#00d17e",
        "selected": "#02ad6e1a",
        "selectedSubtle": "#02ad6e0d",
        "selectedStrong": "#02ad6e33"
      },
      "content": {
        "accent": "#4ad99a",
        "accentHover": "#00d17e",
        "onAccentSubtle": "#a7f2cf"
      },
      "stroke": {
        "accent": "#02ad6e",
        "accentMedium": "#02ad6e66",
        "accentSubtle": "#02ad6e1a"
      },
      "surface": {
        "accent": "#02ad6e",
        "accentSubtle": "#02ad6e1a"
      }
    },
    "hacker": {
      "interactive": {
        "primary": "#02ad6e",
        "selected": "#02ad6e1a",
        "selectedSubtle": "#02ad6e0d",
        "selectedStrong": "#02ad6e33"
      },
      "content": {
        "accent": "#4ad99a"
      },
      "stroke": {
        "accent": "#02ad6e",
        "accentMedium": "#02ad6e66",
        "accentSubtle": "#02ad6e1a"
      },
      "surface": {
        "accent": "#02ad6e",
        "accentSubtle": "#02ad6e1a"
      }
    }
  }
} as const;

/** `surfaceMode="elevated"`: used inside floating layers (menus, popovers, toasts, alert dialogs). */
export const elevatedOverrides = {
  "light": {
    "stroke": {
      "primarySubtle": "#00000000"
    },
    "surface": {
      "primaryHover": "#f6f7f7"
    }
  },
  "dark": {
    "interactive": {
      "secondary": "#17181a"
    },
    "stroke": {
      "primary": "#212224",
      "primarySubtle": "#212224"
    },
    "surface": {
      "primary": "#17181a",
      "primaryHover": "#212224",
      "secondary": "#141517"
    }
  },
  "hacker": {
    "interactive": {
      "secondary": "#17181a"
    },
    "stroke": {
      "primary": "#0b0c0d",
      "primarySubtle": "#244a3a"
    },
    "surface": {
      "primary": "#0b0c0d",
      "primaryHover": "#17181a",
      "secondary": "#141517"
    }
  }
} as const;

export const elevation = {
  "light": {
    "e1": "inset 0px 0px 0px 1px #0000, 0px 0px 2px 0px #1c28402e, 0px 1px 3px 0px #0000000a",
    "e2": "inset 0px 0px 0px 1px #0000, 0px 0px 0px 1px #1c28400a, 0px 4px 8px -4px #1c28401f, 0px 4px 12px -2px #18294b29",
    "e3": "0px 8px 28px -6px #1c28401f, 0px 18px 88px -4px #1c284029, 0px 0px 1px 0px #1c284029"
  },
  "dark": {
    "e1": "inset 0px 0px 0px 1px #212224, 0px 0px 2px 0px #0000000a, 0px 1px 3px 0px #0000001f",
    "e2": "inset 0px 0px 0px 1px #212224, 0px 0px 0px 1px #00000029, 0px 4px 8px -4px #0000003d, 0px 4px 12px -2px #00000052",
    "e3": "0px 8px 28px -6px #0000007a, 0px 18px 88px -4px #000000a3"
  },
  "hacker": {
    "e1": "inset 0px 0px 0px 1px #244a3a, 0px 0px 2px 0px #0000000a, 0px 1px 3px 0px #0000001f",
    "e2": "inset 0px 0px 0px 1px #244a3a, 0px 0px 0px 1px #00000029, 0px 4px 8px -4px #0000003d, 0px 4px 12px -2px #00000052",
    "e3": "0px 8px 28px -6px #0000007a, 0px 18px 88px -4px #000000a3"
  }
} as const;
