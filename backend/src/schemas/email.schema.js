import { z } from 'zod';

export const emailIngestionSchema = z.object({
  from: z.string().email("Invalid 'from' email address").min(1, "'from' email address cannot be empty"),
  to: z.string().email("Invalid 'to' email address").min(1, "'to' email address cannot be empty"),
  subject: z.string().min(1, "Subject cannot be empty").max(500, "Subject too long"),
  body: z.string().min(1, "Email body cannot be empty"),
  html_body: z.string().optional(),
  date_received: z.string().datetime("Invalid 'date_received' format. Expected ISO 8601 string."),
  message_id: z.string().min(1, "Message ID cannot be empty"),
  in_reply_to: z.string().optional(),
  references: z.string().optional(),
}).strict("Unknown field in email ingestion payload");

export const emailVerificationSchema = z.object({
  email: z.string().email("Invalid email address").min(1, "Email address cannot be empty"),
});

export const validateEmail = emailVerificationSchema.parse;
