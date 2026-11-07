import LoginForm from "./LoginForm";

export default function TravelLoginPage() {
  return (
    <div className="mx-auto mt-16 max-w-xs">
      <h1 className="mb-1 text-lg font-medium text-prose">Llama + Shrimp Travels</h1>
      <p className="mb-6 text-sm text-faint">Sign in to see the budget and trips.</p>
      <LoginForm />
    </div>
  );
}
