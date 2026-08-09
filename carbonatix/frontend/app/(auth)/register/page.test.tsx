import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import RegisterPage from "./page";
import { ThemeProvider } from "@/components/shell/ThemeProvider";

const signUpMock = vi.fn();
const pushMock = vi.fn();

vi.mock("@/lib/supabase", () => ({
  createBrowserClient: () => ({
    auth: { signUp: signUpMock },
  }),
  translateAuthError: (message: string) => message,
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

function renderRegister() {
  return render(
    <ThemeProvider>
      <RegisterPage />
    </ThemeProvider>,
  );
}

describe("RegisterPage", () => {
  beforeEach(() => {
    signUpMock.mockReset();
    pushMock.mockReset();
  });

  it("does not navigate to onboarding when signUp returns no session", async () => {
    signUpMock.mockResolvedValue({
      data: { user: { id: "u1" }, session: null },
      error: null,
    });
    const user = userEvent.setup();
    renderRegister();

    await user.type(screen.getByLabelText("Email"), "operator@smelter.id");
    await user.type(screen.getByLabelText("Kata Sandi"), "secret12");
    await user.click(screen.getByRole("button", { name: "Daftar" }));

    await waitFor(() => {
      expect(
        screen.getByText(/Periksa email Anda untuk konfirmasi akun sebelum masuk/),
      ).toBeInTheDocument();
    });
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("navigates to onboarding when signUp returns a session", async () => {
    signUpMock.mockResolvedValue({
      data: {
        user: { id: "u1" },
        session: { access_token: "tok" },
      },
      error: null,
    });
    const user = userEvent.setup();
    renderRegister();

    await user.type(screen.getByLabelText("Email"), "operator@smelter.id");
    await user.type(screen.getByLabelText("Kata Sandi"), "secret12");
    await user.click(screen.getByRole("button", { name: "Daftar" }));

    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith("/onboarding");
    });
  });
});
