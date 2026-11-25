import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/client/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/client/components/ui/dialog";
import { ProjectAccessPicker } from "@/client/features/team/ProjectAccessPicker";
import { setMemberProjectAccess } from "@/serverFunctions/organization";

export function EditProjectAccessModal({
  userId,
  email,
  initialProjectIds,
  onClose,
  onSaved,
}: {
  userId: string;
  email: string;
  initialProjectIds: string[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [projectIds, setProjectIds] = useState(initialProjectIds);
  const saveMutation = useMutation({
    mutationFn: () => setMemberProjectAccess({ data: { userId, projectIds } }),
    onSuccess: () => {
      toast.success("Project access updated");
      onSaved();
      onClose();
    },
    onError: () => toast.error("We couldn't update that access."),
  });

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !saveMutation.isPending) onClose();
      }}
    >
      <DialogContent showCloseButton={false} className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Projects for {email}</DialogTitle>
          <DialogDescription>
            They can open only the projects you tick here.
          </DialogDescription>
        </DialogHeader>
        <ProjectAccessPicker value={projectIds} onChange={setProjectIds} />
        <DialogFooter>
          <Button
            variant="ghost"
            onClick={onClose}
            disabled={saveMutation.isPending}
          >
            Cancel
          </Button>
          <Button
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending}
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
