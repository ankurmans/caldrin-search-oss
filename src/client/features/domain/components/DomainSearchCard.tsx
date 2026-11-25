import type { FormEvent } from "react";
import { useStore } from "@tanstack/react-form";
import { getFieldError } from "@/client/lib/forms";
import type { DomainOverviewControlsForm } from "@/client/features/domain/DomainOverviewPage";
import { ResearchScopeSelect } from "@/client/components/ResearchScopeSelect";
import { SearchCard, SearchInput } from "@/client/components/SearchCard";
import type { ResearchScope } from "@/shared/researchScope";

type Props = {
  controlsForm: DomainOverviewControlsForm;
  isLoading: boolean;
  onSubmit: (event: FormEvent) => void;
  onDomainChange: (domain: string) => void;
  onScopeChange: (scope: ResearchScope) => void;
};

export function DomainSearchCard({
  controlsForm,
  isLoading,
  onSubmit,
  onDomainChange,
  onScopeChange,
}: Props) {
  const domainError = useStore(controlsForm.store, (state) =>
    getFieldError(state.fieldMeta.domain?.errors ?? []),
  );

  return (
    <SearchCard
      onSubmit={onSubmit}
      pending={isLoading}
      error={domainError}
      errorId="domain-input-error"
    >
      <controlsForm.Field name="domain">
        {(field) => (
          <SearchInput
            placeholder="Competitor or any domain, e.g. example.com"
            aria-label="Domain or URL to analyze"
            autoFocus
            value={field.state.value}
            onChange={(event) => {
              field.handleChange(event.target.value);
              onDomainChange(event.target.value);
            }}
            aria-invalid={domainError ? true : undefined}
            aria-describedby={domainError ? "domain-input-error" : undefined}
          />
        )}
      </controlsForm.Field>

      <controlsForm.Field name="scope">
        {(field) => (
          <ResearchScopeSelect
            value={field.state.value}
            className="w-full lg:w-40"
            onChange={(scope) => {
              field.handleChange(scope);
              onScopeChange(scope);
            }}
          />
        )}
      </controlsForm.Field>
    </SearchCard>
  );
}
