import { createRetrievalApiHandlers, getRetrievalService } from "@/server/retrieval-service";

// Configured retrieval sources and the available adapters.
export async function GET(request: Request) {
  return createRetrievalApiHandlers(getRetrievalService()).list(request);
}

// Adds a source. It is created disabled; nothing is retrieved until it is
// enabled.
export async function POST(request: Request) {
  return createRetrievalApiHandlers(getRetrievalService()).create(request);
}
