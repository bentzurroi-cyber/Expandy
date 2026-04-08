/** @type {import('tailwindcss').Config} */
export default {
  darkMode: ["class"],
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      fontFamily: {
        sans: [
          "Inter",
          "Rubik",
          "Segoe UI",
          "ui-sans-serif",
          "system-ui",
          "sans-serif",
        ],
      },
      keyframes: {
        savingsBarPulse: {
          "0%": {
            filter: "brightness(1)",
            transform: "scaleY(1)",
            boxShadow: "0 0 0 0 rgba(16, 185, 129, 0)",
          },
          "35%": {
            filter: "brightness(1.22)",
            transform: "scaleY(1.28)",
            boxShadow: "0 0 24px 6px rgba(16, 185, 129, 0.45)",
          },
          "55%": {
            filter: "brightness(1.12)",
            transform: "scaleY(1.12)",
            boxShadow: "0 0 16px 4px rgba(16, 185, 129, 0.3)",
          },
          "100%": {
            filter: "brightness(1)",
            transform: "scaleY(1)",
            boxShadow: "0 0 0 0 rgba(16, 185, 129, 0)",
          },
        },
        savingsBarIdle: {
          "0%, 100%": { filter: "brightness(1)", opacity: "0.92" },
          "50%": { filter: "brightness(1.08)", opacity: "1" },
        },
        financialReviewStep: {
          "0%": { opacity: "0", transform: "translateY(6px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        "savings-bar-pulse": "savingsBarPulse 0.95s cubic-bezier(0.22, 1, 0.36, 1)",
        "savings-bar-idle": "savingsBarIdle 2.8s ease-in-out infinite",
        "financial-review-step": "financialReviewStep 0.38s ease-out both",
      },
    },
  },
  plugins: [],
};
