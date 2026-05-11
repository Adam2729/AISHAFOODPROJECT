import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";

import OrangeButton from "@/src/components/OrangeButton";
import { colors } from "@/src/theme/colors";

type CancellationReasonOption = {
  code: string;
  label: string;
  fallbackReason?: string;
};

export const MERCHANT_CANCELLATION_OPTIONS: CancellationReasonOption[] = [
  { code: "restaurant_too_busy", label: "Restaurant is too busy" },
  { code: "item_unavailable", label: "Item unavailable" },
  { code: "other", label: "Closing soon", fallbackReason: "Closing soon" },
  {
    code: "other",
    label: "Customer requested cancellation",
    fallbackReason: "Customer requested cancellation",
  },
  { code: "payment_issue", label: "Payment issue" },
  { code: "other", label: "Other" },
];

type OrderCancellationModalProps = {
  visible: boolean;
  loading?: boolean;
  selectedReasonLabel: string;
  note: string;
  inlineError: string;
  onSelectReason: (value: string) => void;
  onChangeNote: (value: string) => void;
  onClose: () => void;
  onConfirm: () => void;
};

export function buildMerchantCancellationPayload(
  selectedReasonLabel: string,
  note: string
) {
  const selected = MERCHANT_CANCELLATION_OPTIONS.find(
    (option) => option.label === selectedReasonLabel
  );
  const normalizedNote = String(note || "").trim();
  const fallbackReason = String(selected?.fallbackReason || "").trim();

  return {
    status: "cancelled",
    cancelReasonCode: selected?.code || "",
    cancelReason: fallbackReason || "",
    cancellationReason: fallbackReason || "",
    cancelNote: normalizedNote,
    cancellationNote: normalizedNote,
  };
}

export default function OrderCancellationModal({
  visible,
  loading = false,
  selectedReasonLabel,
  note,
  inlineError,
  onSelectReason,
  onChangeNote,
  onClose,
  onConfirm,
}: OrderCancellationModalProps) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.card}>
          <Text style={styles.title}>Cancel order</Text>
          <Text style={styles.subtitle}>
            Please select a reason for cancelling this order.
          </Text>

          <ScrollView style={styles.reasonList} contentContainerStyle={styles.reasonListContent}>
            {MERCHANT_CANCELLATION_OPTIONS.map((option) => {
              const active = selectedReasonLabel === option.label;
              return (
                <Pressable
                  key={option.label}
                  style={[styles.reasonRow, active && styles.reasonRowActive]}
                  onPress={() => onSelectReason(option.label)}
                >
                  <View style={[styles.radio, active && styles.radioActive]} />
                  <Text style={[styles.reasonText, active && styles.reasonTextActive]}>
                    {option.label}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>

          {inlineError ? <Text style={styles.errorText}>{inlineError}</Text> : null}

          <View style={styles.fieldGroup}>
            <Text style={styles.fieldLabel}>Additional details optional</Text>
            <TextInput
              value={note}
              onChangeText={onChangeNote}
              placeholder="Add any useful detail for the team"
              placeholderTextColor="#94A3B8"
              multiline
              textAlignVertical="top"
              style={styles.textArea}
            />
          </View>

          <View style={styles.actions}>
            <OrangeButton label="Back" variant="outline" onPress={onClose} style={styles.action} />
            <OrangeButton
              label="Confirm cancellation"
              variant="danger"
              onPress={onConfirm}
              loading={loading}
              style={styles.action}
            />
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(15,23,42,0.45)",
    justifyContent: "center",
    padding: 20,
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: 24,
    padding: 18,
    borderWidth: 1,
    borderColor: colors.border,
    gap: 14,
  },
  title: {
    color: colors.text,
    fontSize: 24,
    fontWeight: "900",
  },
  subtitle: {
    color: colors.muted,
    lineHeight: 20,
  },
  reasonList: {
    maxHeight: 260,
  },
  reasonListContent: {
    gap: 8,
  },
  reasonRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: colors.card,
  },
  reasonRowActive: {
    borderColor: colors.danger,
    backgroundColor: colors.dangerSoft,
  },
  radio: {
    width: 18,
    height: 18,
    borderRadius: 999,
    borderWidth: 2,
    borderColor: "#CBD5E1",
    backgroundColor: "#FFFFFF",
  },
  radioActive: {
    borderColor: colors.danger,
    backgroundColor: colors.danger,
  },
  reasonText: {
    flex: 1,
    color: colors.text,
    fontSize: 14,
    fontWeight: "700",
  },
  reasonTextActive: {
    color: colors.danger,
  },
  errorText: {
    color: colors.danger,
    fontSize: 13,
    fontWeight: "700",
  },
  fieldGroup: {
    gap: 8,
  },
  fieldLabel: {
    color: colors.text,
    fontSize: 13,
    fontWeight: "800",
  },
  textArea: {
    minHeight: 96,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: colors.text,
    backgroundColor: colors.card,
    fontSize: 14,
  },
  actions: {
    flexDirection: "row",
    gap: 10,
  },
  action: {
    flex: 1,
  },
});
