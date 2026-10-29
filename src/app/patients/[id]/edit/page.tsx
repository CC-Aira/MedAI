import { notFound } from "next/navigation";
import PatientForm from "@/components/PatientForm";
import SheetShell from "@/components/SheetShell";
import { requireUser } from "@/lib/auth";
import { serializePatient, findOwnedPatient } from "@/lib/patients";

export const dynamic = "force-dynamic";

export default async function EditPatientPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireUser();
  const { id } = await params;

  // findFirst + ownerId：别人的档案在这里就是 404，不会泄露 id 是否存在
  const row = await findOwnedPatient(user.id, id);
  if (!row) notFound();

  return (
    <SheetShell backHref={`/patients/${id}`} backLabel="回到档案">
      <PatientForm patient={serializePatient(row)} />
    </SheetShell>
  );
}
