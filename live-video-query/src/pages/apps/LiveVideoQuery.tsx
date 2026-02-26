import { useState, useEffect, useRef, useCallback } from "react";
import { Video, RefreshCw, Loader2, Trash2, MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useVaidioApi } from "@/hooks/useVaidioApi";
import { useSceneQuery, ChatMessage } from "@/hooks/useSceneQuery";
import { ScrollArea } from "@/components/ui/scroll-area";

const quickPrompts = [
  "What is happening?",
  "Anything unusual?",
  "How many people?",
  "Safety concerns?",
];

export default function LiveVideoQuery() {
  const {
    isLoading, snapshotBase64, activeCameraId, cameras,
    fetchSnapshot, fetchCameras, findWorkingCamera,
  } = useVaidioApi();

  const { messages, isQuerying, streamingContent, queryScene, clearHistory } = useSceneQuery();

  const [isConnected, setIsConnected] = useState(false);
  const [question, setQuestion] = useState("");
  const [selectedCameraId, setSelectedCameraId] = useState<number | null>(null);
  const historyEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll history
  useEffect(() => {
    historyEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingContent]);

  // Connect & find working camera
  const connectToVaidio = useCallback(async () => {
    const cameraList = await fetchCameras();
    if (cameraList.length > 0) {
      const cameraId = await findWorkingCamera();
      if (cameraId) {
        const cam = cameraList.find((c) => c.id === cameraId);
        setSelectedCameraId(cameraId);
        setIsConnected(true);
        toast.success(`Camera ${cam?.name || cameraId} loaded.`);
      } else {
        setSelectedCameraId(cameraList[0].id);
        setIsConnected(true);
        toast.success(`${cameraList.length} cameras found.`);
      }
    } else {
      toast.error("No cameras available");
    }
  }, [findWorkingCamera, fetchCameras, toast]);

  // Auto-connect on mount
  useEffect(() => {
    if (!isConnected) connectToVaidio();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Snapshot polling
  useEffect(() => {
    if (!isConnected || !selectedCameraId) return;
    fetchSnapshot(selectedCameraId);
    const interval = setInterval(() => fetchSnapshot(selectedCameraId), 5000);
    return () => clearInterval(interval);
  }, [isConnected, selectedCameraId, fetchSnapshot]);

  const handleCameraChange = (val: string) => {
    const camId = Number(val);
    setSelectedCameraId(camId);
    fetchSnapshot(camId);
  };

  // Submit question
  const handleSubmit = () => {
    if (!question.trim() || !snapshotBase64 || isQuerying) return;
    queryScene(snapshotBase64, question.trim());
    setQuestion("");
  };

  const handleQuickPrompt = (prompt: string) => {
    if (!snapshotBase64 || isQuerying) return;
    queryScene(snapshotBase64, prompt);
  };

  useEffect(() => {
    document.title = "Live Video Query";
  }, []);

  return (
    <div className="h-full flex flex-col overflow-hidden">

      {/* Main content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left panel - Camera feed + Question input */}
        <div className="flex-1 flex flex-col border-r border-border min-w-0">
          {/* Camera selector */}
          <div className="px-4 py-2 border-b border-border flex items-center gap-3 shrink-0">
            <span className="text-sm font-medium text-muted-foreground">Camera</span>
            <Select
              value={selectedCameraId ? selectedCameraId.toString() : ""}
              onValueChange={handleCameraChange}
            >
              <SelectTrigger className="flex-1 bg-secondary h-8 text-sm">
                <SelectValue placeholder="Select camera..." />
              </SelectTrigger>
              <SelectContent>
                {cameras.map((cam) => (
                  <SelectItem key={cam.id} value={cam.id.toString()}>
                    {cam.name || `Camera ${cam.id}`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {isConnected && selectedCameraId && (
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => fetchSnapshot(selectedCameraId)}
              >
                <RefreshCw className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>

          {/* Video feed */}
          <div className="p-3 min-h-0">
            <div className="w-full max-h-[60vh] bg-black rounded-lg flex items-center justify-center overflow-hidden relative">
              {snapshotBase64 ? (
                <>
                  <img
                    src={snapshotBase64}
                    alt="Camera Live Feed"
                    className="w-full h-full object-contain"
                  />
                  {selectedCameraId && (
                    <div className="absolute bottom-2 left-2 bg-black/70 text-white text-xs px-2 py-0.5 rounded">
                      {cameras.find((c) => c.id === selectedCameraId)?.name || `Camera ${selectedCameraId}`}
                    </div>
                  )}
                </>
              ) : (
                <div className="text-center text-muted-foreground">
                  {isLoading ? (
                    <Loader2 className="h-10 w-10 mx-auto animate-spin opacity-30" />
                  ) : (
                    <>
                      <Video className="h-10 w-10 mx-auto mb-2 opacity-30" />
                      <p className="text-sm">Connecting to camera...</p>
                    </>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Question input area */}
          <div className="border-t border-border p-3 space-y-2 shrink-0">
            <p className="text-sm font-medium">Ask a question about the scene</p>
            <div className="relative">
              <Textarea
                placeholder="Example: what is happening in this scene?"
                className="w-full bg-secondary resize-none min-h-[80px] max-h-[120px] text-sm pr-24"
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    handleSubmit();
                  }
                }}
                disabled={isQuerying || !snapshotBase64}
              />
              <span className="absolute bottom-2 right-3 text-xs text-muted-foreground/50 pointer-events-none flex items-center gap-1">
                {isQuerying ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <>↵ submit</>
                )}
              </span>
            </div>
            {/* Quick prompts */}
            <div className="flex gap-2 flex-wrap">
              {quickPrompts.map((p) => (
                <Button
                  key={p}
                  variant="secondary"
                  size="sm"
                  className="text-xs h-7"
                  onClick={() => handleQuickPrompt(p)}
                  disabled={isQuerying || !snapshotBase64}
                >
                  {p}
                </Button>
              ))}
            </div>
          </div>
        </div>

        {/* Right panel - History */}
        <div className="w-[400px] flex flex-col shrink-0 max-w-[45%]">
          <div className="px-4 py-2 border-b border-border flex items-center justify-between shrink-0">
            <h2 className="text-sm font-semibold">History</h2>
            {messages.length > 0 && (
              <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" onClick={clearHistory}>
                <Trash2 className="h-3 w-3" /> Clear
              </Button>
            )}
          </div>

          <ScrollArea className="flex-1">
            <div className="p-3 space-y-3">
              {messages.length === 0 && !streamingContent && (
                <div className="text-center text-muted-foreground py-12">
                  <MessageSquare className="h-10 w-10 mx-auto mb-3 opacity-20" />
                  <p className="text-sm">Ask a question to get started</p>
                </div>
              )}

              {messages.map((msg, i) => (
                <ChatBubble key={i} message={msg} />
              ))}

              {/* Streaming response */}
              {streamingContent && (
                <div className="bg-card border border-border rounded-lg p-3">
                  <p className="text-sm whitespace-pre-wrap">{streamingContent}</p>
                  <Loader2 className="h-3 w-3 animate-spin mt-1 text-muted-foreground" />
                </div>
              )}

              <div ref={historyEndRef} />
            </div>
          </ScrollArea>
        </div>
      </div>
    </div>
  );
}

function ChatBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user";

  if (isUser) {
    return (
      <div className="flex flex-col items-end gap-1">
        {message.imageBase64 && (
          <div className="w-full max-w-[240px] rounded-lg overflow-hidden border-2 border-primary/40">
            <img
              src={message.imageBase64}
              alt="Scene snapshot"
              className="w-full h-auto object-cover"
            />
            <div className="bg-primary text-primary-foreground px-3 py-1.5 text-sm">
              {message.content}
            </div>
          </div>
        )}
        {!message.imageBase64 && (
          <div className="bg-primary text-primary-foreground rounded-lg px-3 py-2 text-sm max-w-[90%]">
            {message.content}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="bg-card border border-border rounded-lg p-3">
      <p className="text-sm whitespace-pre-wrap">{message.content}</p>
    </div>
  );
}
