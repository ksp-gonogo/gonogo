import { QRCodeSVG } from "qrcode.react";
import styled from "styled-components";
import type { StationAddress } from "./stationAddresses";

/**
 * The links an operator can give another device to join this main screen,
 * each with the device it suits. The QR code is drawn inside the row of the
 * link it encodes, and that row comes first, so a phone scanning it opens the
 * address printed above it. Used by the Add station panel.
 */
export function StationAddressList({
  addresses,
  qr,
}: Readonly<{
  addresses: readonly StationAddress[];
  qr: StationAddress;
}>) {
  const ordered = [qr, ...addresses.filter((a) => a.id !== qr.id)];
  return (
    <>
      {ordered.map((address) => (
        <UrlRow key={address.id} data-address={address.id}>
          <Label>{address.label}</Label>
          <UrlValue href={address.url} target="_blank" rel="noreferrer">
            {address.url}
          </UrlValue>
          <UrlWhen>{address.when}</UrlWhen>
          {address.id === qr.id && (
            <QrRow>
              <QRCodeSVG
                value={qr.url}
                size={160}
                title={`QR code for ${qr.label}`}
              />
            </QrRow>
          )}
        </UrlRow>
      ))}
    </>
  );
}

const UrlRow = styled.div`
  display: flex;
  flex-direction: column;
  gap: var(--gap-related);
`;

const UrlValue = styled.a`
  color: var(--color-info-text);
  font-size: var(--font-size-value);
  word-break: break-all;
  text-decoration: underline;
  &:hover {
    color: var(--color-text-primary);
  }
`;

const UrlWhen = styled.span`
  font-size: var(--font-size-caption);
  color: var(--color-text-muted);
`;

const Label = styled.span`
  font-size: var(--font-size-caption);
  font-weight: 700;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--color-text-dim);
`;

const QrRow = styled.div`
  display: flex;
  justify-content: center;
  padding: var(--inset-qr);
  background: var(--color-text-primary);
  border-radius: var(--radius-regular);
`;
