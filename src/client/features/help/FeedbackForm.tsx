import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/client/components/ui/button";
import { Textarea } from "@/client/components/ui/textarea";
import { getStandardErrorMessage } from "@/client/lib/error-messages";
import { submitFeedback } from "@/serverFunctions/feedback";
import {
  FEEDBACK_KINDS,
  FEEDBACK_KIND_LABELS,
  FEEDBACK_MAX_CHARS,
  type FeedbackKind,
} from "@/shared/support";

export function FeedbackForm() {
  const [kind, setKind] = useState<FeedbackKind>("feature");
  const [message, setMessage] = useState("");
  const send = useMutation({
    mutationFn: () => submitFeedback({ data: { kind, message } }),
    onSuccess: () => {
      setMessage("");
      toast.success("Sent. Thank you, we read every one.");
    },
    onError: (error) => toast.error(getStandardErrorMessage(error)),
  });

  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        send.mutate();
      }}
    >
      <div className="flex flex-wrap gap-2" role="group" aria-label="Type">
        {FEEDBACK_KINDS.map((option) => (
          <Button
            key={option}
            type="button"
            size="sm"
            variant={kind === option ? "default" : "outline"}
            aria-pressed={kind === option}
            onClick={() => setKind(option)}
          >
            {FEEDBACK_KIND_LABELS[option]}
          </Button>
        ))}
      </div>
      <Textarea
        aria-label="Your message"
        value={message}
        onChange={(event) => setMessage(event.target.value)}
        maxLength={FEEDBACK_MAX_CHARS}
        rows={5}
        placeholder="What would you like to see, or what would work better for you?"
      />
      <Button
        type="submit"
        size="sm"
        pending={send.isPending}
        disabled={message.trim().length < 5}
      >
        Send to the team
      </Button>
    </form>
  );
}
