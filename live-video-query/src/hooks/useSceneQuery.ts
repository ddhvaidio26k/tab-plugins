import { useState, useCallback } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  imageBase64?: string;
  timestamp: Date;
}

/**
 * Build the query-scene edge function URL from the Supabase client config.
 * This avoids hardcoding env vars and keeps the dependency on the shared client.
 */
function getQuerySceneUrl(): string {
  // supabaseUrl is a public property on the Supabase client
  const supabaseUrl = (supabase as any).supabaseUrl as string;
  return `${supabaseUrl}/functions/v1/query-scene`;
}

function getAnonKey(): string {
  return (supabase as any).supabaseKey as string;
}

export function useSceneQuery() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isQuerying, setIsQuerying] = useState(false);
  const [streamingContent, setStreamingContent] = useState("");

  const queryScene = useCallback(
    async (imageBase64: string, question: string) => {
      if (!imageBase64 || !question.trim()) return;

      const userMsg: ChatMessage = {
        role: "user",
        content: question,
        imageBase64,
        timestamp: new Date(),
      };

      setMessages((prev) => [...prev, userMsg]);
      setIsQuerying(true);
      setStreamingContent("");

      try {
        // Build history (last 6 messages for context, text only)
        const history = messages.slice(-6).map((m) => ({
          role: m.role,
          content: m.content,
        }));

        const response = await fetch(getQuerySceneUrl(), {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${getAnonKey()}`,
          },
          body: JSON.stringify({ imageBase64, question, history }),
        });

        if (!response.ok) {
          const err = await response.json().catch(() => ({}));
          if (response.status === 429) {
            toast.error("Rate limit exceeded. Please wait a moment.");
            throw new Error("Rate limited");
          }
          if (response.status === 402) {
            toast.error("Please add credits to continue.");
            throw new Error("Payment required");
          }
          throw new Error(err.error || "Failed to query scene");
        }

        if (!response.body) throw new Error("No response body");

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let textBuffer = "";
        let fullContent = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          textBuffer += decoder.decode(value, { stream: true });

          let newlineIndex: number;
          while ((newlineIndex = textBuffer.indexOf("\n")) !== -1) {
            let line = textBuffer.slice(0, newlineIndex);
            textBuffer = textBuffer.slice(newlineIndex + 1);
            if (line.endsWith("\r")) line = line.slice(0, -1);
            if (line.startsWith(":") || line.trim() === "") continue;
            if (!line.startsWith("data: ")) continue;
            const jsonStr = line.slice(6).trim();
            if (jsonStr === "[DONE]") break;
            try {
              const parsed = JSON.parse(jsonStr);
              const content = parsed.choices?.[0]?.delta?.content;
              if (content) {
                fullContent += content;
                setStreamingContent(fullContent);
              }
            } catch {
              textBuffer = line + "\n" + textBuffer;
              break;
            }
          }
        }

        // Flush remaining
        if (textBuffer.trim()) {
          for (let raw of textBuffer.split("\n")) {
            if (!raw) continue;
            if (raw.endsWith("\r")) raw = raw.slice(0, -1);
            if (raw.startsWith(":") || raw.trim() === "") continue;
            if (!raw.startsWith("data: ")) continue;
            const jsonStr = raw.slice(6).trim();
            if (jsonStr === "[DONE]") continue;
            try {
              const parsed = JSON.parse(jsonStr);
              const content = parsed.choices?.[0]?.delta?.content;
              if (content) {
                fullContent += content;
                setStreamingContent(fullContent);
              }
            } catch {
              /* ignore */
            }
          }
        }

        const assistantMsg: ChatMessage = {
          role: "assistant",
          content: fullContent,
          timestamp: new Date(),
        };
        setMessages((prev) => [...prev, assistantMsg]);
        setStreamingContent("");
      } catch (error) {
        console.error("Scene query error:", error);
        if (error instanceof Error) {
          if (error.message === "Rate limited" || error.message === "Payment required") {
            // Already toasted above
          } else {
            toast.error("Failed to analyze scene");
          }
        } else {
          toast.error("Failed to analyze scene");
        }
        setStreamingContent("");
      } finally {
        setIsQuerying(false);
      }
    },
    [messages]
  );

  const clearHistory = useCallback(() => {
    setMessages([]);
    setStreamingContent("");
  }, []);

  return { messages, isQuerying, streamingContent, queryScene, clearHistory };
}
