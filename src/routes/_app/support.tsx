import { createFileRoute } from "@tanstack/react-router";
import { CopyButton } from "@/client/components/CopyButton";
import { PageHeader } from "@/client/components/PageHeader";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/client/components/ui/card";
import { FeedbackForm } from "@/client/features/help/FeedbackForm";
import { SUPPORT_EMAIL } from "@/client/lib/support";
import { pageHead } from "@/client/lib/pageHead";

export const Route = createFileRoute("/_app/support")({
  head: () => pageHead("Help"),
  component: SupportPage,
});

function SupportPage() {
  return (
    <div className="h-full overflow-auto px-4 py-4 pb-24 md:px-6 md:py-6 md:pb-8">
      <div className="mx-auto max-w-7xl space-y-8">
        <div className="space-y-1">
          <p className="text-sm font-medium text-muted-foreground">Help</p>
          <PageHeader
            title="We want to hear from you"
            description="We want to talk to you! We're super open to feedback and want to learn how you work so we can make Caldrin Search better."
          />
        </div>

        <div className="space-y-3">
          <Card>
            <CardHeader>
              <CardTitle>
                <h2>Request a feature or an improvement</h2>
              </CardTitle>
              <CardDescription>
                This goes straight to the team by email. We reply to your
                account address.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <FeedbackForm />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>
                <h2>Email</h2>
              </CardTitle>
              <CardDescription>
                Send ideas, problems, questions, or feedback directly.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <CopyButton
                value={SUPPORT_EMAIL}
                label={SUPPORT_EMAIL}
                successMessage="Email copied to clipboard"
                size="sm"
              />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
