import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import { AssetsProvider } from "./context/AssetsContext";
import { BudgetProvider } from "./context/BudgetContext";
import { ExpensesProvider } from "./context/ExpensesContext";
import { I18nProvider } from "./context/I18nContext";
import { ThemeProvider } from "./context/ThemeContext";
import { AuthProvider } from "./context/AuthContext";
import "./index.css";
import "react-day-picker/style.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <I18nProvider>
      <AuthProvider>
        <ThemeProvider>
          <AssetsProvider>
            <BudgetProvider>
              <ExpensesProvider>
                <App />
              </ExpensesProvider>
            </BudgetProvider>
          </AssetsProvider>
        </ThemeProvider>
      </AuthProvider>
    </I18nProvider>
  </StrictMode>,
);
