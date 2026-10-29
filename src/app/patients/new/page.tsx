import PatientForm from "@/components/PatientForm";
import SheetShell from "@/components/SheetShell";
import { requireUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function NewPatientPage() {
  await requireUser();

  return (
    <SheetShell>
      <PatientForm />
    </SheetShell>
  );
}
