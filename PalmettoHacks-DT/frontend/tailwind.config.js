/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#09131b",
        panel: "#101d26",
        line: "#20313d",
        muted: "#8b9ba5",
        teal: "#4fe0c1",
        mint: "#78e7a8",
        amber: "#f1bd67",
        danger: "#ff6b70",
      },
      boxShadow: {
        panel: "0 16px 48px rgba(0, 0, 0, 0.18)",
      },
    },
  },
  plugins: [],
};
