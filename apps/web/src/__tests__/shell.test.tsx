import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TooltipProvider, Wordmark } from "@thynkpdf/ui";
import { useViewerStore } from "@thynkpdf/pdf-viewer";
import { Toolbar } from "@/components/Toolbar";
import { StatusBar } from "@/components/StatusBar";

const sizes = Array.from({ length: 3 }, () => ({ width: 612, height: 792 }));
const renderToolbar = () => render(<TooltipProvider><Toolbar onOrganize={() => {}} onOpen={() => {}} onToggleSidebar={() => {}} onTogglePanel={() => {}} onToggleTheme={() => {}} dark={false} /><StatusBar /></TooltipProvider>);

describe("app shell", () => {
  it("renders the wordmark", () => { render(<Wordmark />); expect(screen.getByLabelText("THYNKPDF")).toHaveTextContent("THYNKPDF"); });
  it("disables navigation without a document", () => {
    useViewerStore.getState().setDocument(null, null, []);
    renderToolbar();
    expect(screen.getByLabelText("Next page")).toBeDisabled();
    expect(screen.getByTestId("status-page")).toHaveTextContent("No document");
  });
  it("navigates pages and reflects in status bar; rotate enabled for local docs (no sign-in)", async () => {
    useViewerStore.getState().setDocument({} as never, "a.pdf", sizes);
    renderToolbar();
    await userEvent.click(screen.getByLabelText("Next page"));
    expect(screen.getByTestId("status-page")).toHaveTextContent("Page 2 of 3");
    const input = screen.getByLabelText("Page number");
    await userEvent.clear(input); await userEvent.type(input, "3{enter}");
    expect(screen.getByTestId("status-page")).toHaveTextContent("Page 3 of 3");
    expect(screen.getByLabelText(/Rotate page/)).toBeEnabled();
  });
});
