import { forwardRef, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View, type TextInputProps } from 'react-native';
import { Eye, EyeOff } from 'lucide-react-native';
import { colors, fonts, radius, red } from '@/theme/tokens';
import { Txt } from './Text';

export interface FieldProps extends TextInputProps {
  label: string;
  hint?: string;
  error?: string | null;
  required?: boolean;
  /** Password fields get a show / hide toggle. */
  secure?: boolean;
  right?: React.ReactNode;
}

/** Labelled text input with hint and error, matching the website's TextField. */
export const Field = forwardRef<TextInput, FieldProps>(function Field({ label, hint, error, required, secure, right, style, ...rest }, ref) {
  const [hidden, setHidden] = useState(!!secure);
  return (
    <View style={styles.wrap}>
      <Txt variant="small" style={styles.label}>{label}{required ? <Txt color={colors.redBright}> *</Txt> : null}</Txt>
      <View style={[styles.box, error ? styles.boxError : null]}>
        <TextInput
          ref={ref}
          placeholderTextColor={red(0.45)}
          selectionColor={colors.red}
          secureTextEntry={hidden}
          autoCapitalize={secure ? 'none' : rest.autoCapitalize}
          {...rest}
          style={[styles.input, style]}
        />
        {secure ? (
          <Pressable accessibilityRole="button" accessibilityLabel={hidden ? 'Show password' : 'Hide password'} onPress={() => setHidden((h) => !h)} hitSlop={8} style={styles.eye}>
            {hidden ? <Eye size={18} color={red(0.6)} /> : <EyeOff size={18} color={red(0.6)} />}
          </Pressable>
        ) : right}
      </View>
      {error ? <Txt variant="small" color={colors.redBright} accessibilityLiveRegion="polite">{error}</Txt> : hint ? <Txt variant="caption">{hint}</Txt> : null}
    </View>
  );
});

const styles = StyleSheet.create({
  wrap: { gap: 6 },
  label: { fontFamily: fonts.sansMedium, color: colors.red },
  box: { flexDirection: 'row', alignItems: 'center', minHeight: 48, borderRadius: radius.md, borderWidth: 1, borderColor: red(0.18), backgroundColor: colors.pureWhite, paddingHorizontal: 14 },
  boxError: { borderColor: colors.redBright },
  input: { flex: 1, fontFamily: fonts.sans, fontSize: 16, color: colors.ink, paddingVertical: 10 },
  eye: { paddingLeft: 10 },
});
