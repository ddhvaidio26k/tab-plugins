import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "sonner";
import LiveVideoQuery from "./pages/apps/LiveVideoQuery";

const queryClient = new QueryClient();

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <Toaster />
      <div className="h-screen w-screen bg-background text-foreground">
        <LiveVideoQuery />
      </div>
    </QueryClientProvider>
  );
}