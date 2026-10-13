// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { ReferralLinks } from "./ReferralLinks.js";
afterEach(cleanup);
it("copies the complete attributed URL and reports clipboard failure", async () => {
  const writeText = vi
    .fn()
    .mockResolvedValueOnce(undefined)
    .mockRejectedValueOnce(new Error("Clipboard blocked"));
  render(
    <ReferralLinks
      links={[
        {
          id: "store",
          label: "Independent Store",
          url: "https://app.test/stores?store=acct_one&ref=avery",
        },
      ]}
      writeText={writeText}
    />,
  );
  await userEvent.click(
    screen.getByRole("button", {
      name: "Copy referral link for Independent Store",
    }),
  );
  expect(writeText).toHaveBeenCalledWith(
    "https://app.test/stores?store=acct_one&ref=avery",
  );
  expect(screen.getByRole("status").textContent).toContain("copied");
  await userEvent.click(
    screen.getByRole("button", {
      name: "Copy referral link for Independent Store",
    }),
  );
  expect(screen.getByRole("alert").textContent).toContain("Clipboard blocked");
});
