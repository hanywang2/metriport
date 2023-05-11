import { DocumentReference } from "@medplum/fhirtypes";
import base64url from "base64url";
import { CodeableConceptDTO, toDTO as codeableToDTO } from "./codeableDTO";
import { capture } from "../../../shared/notifications";

export type DocumentReferenceDTO = {
  id: string;
  fileName: string;
  location: string;
  description: string | undefined;
  status: string | undefined;
  indexed: string | undefined; // ISO-8601
  mimeType: string | undefined;
  size: number | undefined; // bytes
  type: CodeableConceptDTO | undefined;
};

export function toDTO(docs: DocumentReference[] | undefined): DocumentReferenceDTO[] {
  if (docs) {
    return docs.flatMap(doc => {
      if (doc && doc.id && doc.content) {
        const decodedId = base64url.decode(doc.id);
        const hasAttachment = doc.content[0];

        if (doc.content.length > 1) {
          capture.message("Doc contains more than one content item", {
            extra: {
              id: decodedId,
              content_length: doc.content.length,
            },
          });
        }

        if (
          hasAttachment &&
          hasAttachment.attachment &&
          hasAttachment.attachment.title &&
          hasAttachment.attachment.url
        ) {
          return {
            id: decodedId,
            description: doc.description,
            fileName: hasAttachment.attachment.title,
            location: hasAttachment.attachment.url,
            type: codeableToDTO(doc.type),
            status: doc.status,
            indexed: hasAttachment.attachment.creation,
            mimeType: hasAttachment.attachment.contentType,
            size: hasAttachment.attachment.size,
          };
        }

        return [];
      }

      return [];
    });
  }

  return [];
}
